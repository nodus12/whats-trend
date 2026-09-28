// 3-4단계: 여러 키워드에 대해 YouTube/뉴스/네이버 수집을 주기적으로
// 자동 실행하는 스케줄러.
//
// server/trendMonitor.js(18-1, 10분 간격 단일 쿼리 감시)와 구조적으로
// 같은 원칙을 따릅니다: "무엇을 언제 수집할지"는 이 파일이 담당하고,
// setInterval 자체의 등록/해제(서버 시작 시점과의 연결)는 server.js가
// 담당합니다 - 이 파일은 스케줄을 스스로 시작하지 않습니다. 다만
// trendMonitor.js와 달리 서버 시작 즉시 1회 실행하지 않습니다(재시작 시
// 할당량이 바로 소모되는 것을 막기 위함 - 3-4단계 지시사항).
//
// 3-4단계 사전 확인으로 실제 코드를 읽어 확정한 소스별 수집 방식:
//   - YouTube: 수집(calculateYoutubeTrend)과 저장(saveYoutubeDailyTrend)이
//     분리되어 있음(/api/youtube/trend 라우트와 동일한 순서로 호출).
//   - 뉴스: collectNewsDailyMentionCount()가 수집만, saveNewsDailyTrend()가
//     저장만 담당(/api/news/trend-growth 라우트가 이 둘을 먼저 호출한 뒤
//     계산까지 하는 것과 동일하게, 이 스케줄러는 수집+저장까지만 재현하고
//     계산(calculateNewsTrendGrowth)은 호출하지 않습니다 - 성장률 계산은
//     온디맨드로 충분하다는 지시사항 때문).
//   - 네이버: getNaverTrendGrowth() 하나가 조회+캐싱을 전부 처리하므로
//     이 함수 한 번만 호출합니다(별도 저장 함수 없음).
//
// AI 설명 생성(youtubeTrendExplanation.js)이나 /api/trend-score 종합 계산은
// 이 스케줄러 범위에 포함하지 않습니다 - 조회 시점에 온디맨드로 계산되는
// 것으로 충분하고, 스케줄러가 매번 이걸 돌리면 Gemini 호출이 불필요하게
// 늘어납니다.
//
// 4-1단계: SCHEDULER_ENABLED + setInterval(이 파일의 runScheduledCollection을
// 주기 실행) 조합은 무료 티어처럼 idle 상태에서 프로세스가 내려갔다가
// 요청이 와야 다시 뜨는 "spin-down" 배포 환경에서는 신뢰할 수 없습니다 -
// 프로세스가 내려가 있는 동안 setInterval 자체가 멈추므로 인터벌이 조용히
// 건너뛰어질 수 있습니다. 그래서 이 로직은 삭제하지 않고 그대로 남겨두되
// (유료 플랜으로 전환해 프로세스가 상시 떠 있게 되면 다시 쓸 수 있도록),
// 지금 배포에서는 POST /api/scheduler/trigger(외부 크론 서비스가 주기적으로
// 호출)를 대신 씁니다. **spin-down 환경에 배포할 때는 SCHEDULER_ENABLED를
// 반드시 꺼둔 채로 유지하세요** - 켜봤자 신뢰할 수 없는 스케줄만 될 뿐,
// runScheduledCollection() 자체(및 아래 isRunning 플래그)는 외부 트리거
// 경로(server.js의 /api/scheduler/trigger)에서도 그대로 재사용됩니다.
import { calculateYoutubeTrend } from "./youtubeTrend.js";
import { saveYoutubeDailyTrend, toUtcDateString } from "./youtubeDailyTrend.js";
import {
  collectNewsDailyMentionCount,
  saveNewsDailyTrend,
  toUtcDateString as toUtcNewsDateString,
} from "./newsDailyTrend.js";
import { getNaverTrendGrowth } from "./naverTrendGrowth.js";
import { getCompositeTrendScore } from "./compositeTrendScore.js";
import { listActiveTrackedKeywords } from "./trackedKeywords.js";
import { saveCompositeSnapshot, updateCompositeSnapshotExplanation } from "./trendHistoryApi.js";
import { generateCompositeExplanation } from "./compositeTrendExplanation.js";
import { discoverTrendingKeywords, expireAutoKeywords } from "./autoKeywordDiscovery.js";

// 4-2단계: 종합점수 일별 스냅샷. getCompositeTrendScore()는 내부적으로
// calculateYoutubeTrendGrowth/calculateNewsTrendGrowth(Supabase 조회만,
// 외부 API 호출 없음)와 getNaverTrendGrowth()를 다시 호출합니다 - 네이버
// 쪽은 바로 위 collectNaverForKeyword()가 같은 날짜로 이미 캐시를 채워둔
// 뒤라 naverTrendGrowth.js의 캐시 우선 조회 로직에 의해 캐시 히트로
// 처리되므로, 이 스냅샷 단계 때문에 네이버 API가 추가로 호출되지는
// 않습니다.
function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

// 하루 3회 기준 8시간.
export const SCHEDULED_COLLECTION_INTERVAL_MS = 8 * 60 * 60 * 1000;

// 9-0단계: 키워드 하나 처리(collectAllSourcesForKeyword)에 거는 상한
// 시간. 8-0단계 실측에서 종합점수 설명 생성(Gemini) 단계가 응답 없이
// 멈춰서 스케줄러 전체가 멈추는 것을 실제로 관찰했습니다 - 개별 소스마다
// try/catch가 있어도, throw 자체가 안 일어나는 hang은 잡지 못합니다.
// 아래 createTimeoutRejection()과 Promise.race로 감싸서, 이 시간을
// 넘기면 해당 키워드를 건너뛰고 다음 키워드로 넘어가게 합니다.
//
// 주의(한계): Promise.race는 "더는 기다리지 않는다"는 것이지 진행 중인
// 내부 fetch를 실제로 취소하지는 않습니다 - 시간이 초과된 키워드의
// 이전 요청은 백그라운드에서 계속 진행되다가 나중에 스스로 끝나거나
// 실패합니다(그 결과는 버려짐). AbortController를 모든 소스 함수까지
// 관통시켜 실제로 취소하는 것은 이번 작업 범위 밖입니다.
//
// 주의(unref를 쓰지 않는 이유 - 9-0단계 검증 [3]에서 실제로 재현/발견):
// 처음에는 이 타이머에 timer.unref()를 걸었습니다("안전장치 타이머 자체가
// 프로세스 종료를 막으면 안 된다"는 의도). 하지만 실제로 완전히 멈춘
// 작업(예: new Promise(() => {})처럼 어떤 I/O 핸들도 잡지 않는 hang)과
// Promise.race시키면, 이벤트 루프에 unref된 타이머 말고는 아무 활성
// 핸들도 안 남아서 Node가 "할 일이 없다"고 판단해 그 타이머가 발동하기도
// 전에 프로세스를 조용히 종료해버리는 것을 독립 스크립트로 직접
// 재현했습니다. 이러면 안전장치가 있으나 마나 해집니다(정확히 막으려던
// 상황에서 무력화됨). 그래서 unref를 걸지 않습니다 - 대신 아래처럼 진짜
// 작업이 먼저 끝나면 반드시 clearTimeout으로 타이머를 정리해서, 정상
// 케이스에서 이 타이머 때문에 다음 실행(예: 서버 종료)이 막히지 않게
// 합니다.
export const PER_KEYWORD_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * ms 후에 reject되는 Promise와, 그 타이머를 즉시 정리하는 cancel()을
 * 함께 반환합니다. Promise.race에서 진짜 작업과 경쟁시켜 "상한 시간"을
 * 구현하는 용도입니다. 진짜 작업이 먼저 끝나면 반드시 cancel()을 호출해서
 * (finally 블록에서) 타이머가 나중에 혼자 발동해 처리되지 않는 rejection을
 * 만들지 않게 해야 합니다.
 * @param {number} ms
 * @param {string} message
 * @returns {{promise: Promise<never>, cancel: () => void}}
 */
function createTimeoutRejection(ms, message) {
  let timer;
  const promise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(message);
      error.code = "scheduler_keyword_timeout";
      reject(error);
    }, ms);
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

let isRunning = false;

/**
 * 현재 스케줄 수집 사이클이 실행 중인지 확인합니다(trendMonitor.js의
 * isTrendMonitorRunning()과 동일한 목적의 중복 실행 방지 플래그).
 * @returns {boolean}
 */
export function isSchedulerRunning() {
  return isRunning;
}

/**
 * /api/youtube/trend 라우트와 동일한 순서(calculateYoutubeTrend ->
 * saveYoutubeDailyTrend, periods["1d"]/capped["1d"] 사용)로 YouTube
 * 일별 데이터를 수집·저장합니다.
 * @param {string} keyword
 */
async function collectYoutubeForKeyword(keyword) {
  const trend = await calculateYoutubeTrend(keyword);
  await saveYoutubeDailyTrend({
    keyword: trend.keyword,
    collectedDate: toUtcDateString(trend.collectedAt),
    videoCount: trend.periods["1d"],
    capped: trend.capped["1d"],
  });
}

/**
 * /api/news/trend-growth 라우트가 계산 전에 먼저 하는 수집·저장 부분만
 * (collectNewsDailyMentionCount -> saveNewsDailyTrend) 재현합니다.
 * 뒤이은 calculateNewsTrendGrowth() 호출은 하지 않습니다(스케줄러 범위 밖).
 * @param {string} keyword
 */
async function collectNewsForKeyword(keyword) {
  const collected = await collectNewsDailyMentionCount(keyword);
  await saveNewsDailyTrend({
    keyword: collected.keyword,
    collectedDate: toUtcNewsDateString(collected.collectedAt),
    mentionCount: collected.mentionCount,
    capped: collected.capped,
  });
}

/**
 * getNaverTrendGrowth() 하나로 조회+캐싱이 전부 처리됩니다. 이 함수는
 * API 실패도 throw하지 않고 { error } 형태로 삼키므로(naverTrendGrowth.js
 * 참고), 여기서 반환값을 별도로 검사하지 않습니다 - 실패해도 예외 없이
 * 조용히 끝나며, 성공 시 자체적으로 naver_trend_cache에 저장됩니다.
 * @param {string} keyword
 */
async function collectNaverForKeyword(keyword) {
  await getNaverTrendGrowth(keyword);
}

/**
 * 위 세 소스 수집이 끝난 뒤, getCompositeTrendScore()를 그대로 호출해
 * 종합점수를 계산하고 composite_trend_snapshots에 upsert합니다. 이
 * 단계가 실패해도(계산 실패, Supabase 저장 실패 등) 해당 키워드의 나머지
 * 처리나 다음 키워드 진행에 영향을 주지 않습니다 - 호출부에서 이 함수
 * 전체를 try/catch로 감쌉니다.
 * @param {string} keyword
 */
async function saveCompositeSnapshotForKeyword(keyword) {
  const result = await getCompositeTrendScore(keyword);
  const snapshotDate = formatDate(new Date());

  await saveCompositeSnapshot({
    keyword,
    snapshotDate,
    compositeScore: result.compositeScore,
    sources: result.sources,
  });

  // 5-1단계: 스냅샷 저장이 성공한 직후, 같은 함수 안에서 AI 설명을 생성해
  // 같은 row에 update합니다. 독립 try/catch로 격리해서 실패해도(Gemini
  // 오류, DB 업데이트 실패 등) 위 스냅샷 저장 자체나 다음 키워드 처리에는
  // 전혀 영향을 주지 않습니다 - /api/trend-score는 이 값을 만들지 않고
  // 읽기만 하므로, 여기서 실패하면 그냥 explanation 없이 남을 뿐입니다.
  try {
    const explanationResult = await generateCompositeExplanation({
      keyword,
      compositeScore: result.compositeScore,
      sources: result.sources,
    });

    if (explanationResult.explanation) {
      await updateCompositeSnapshotExplanation({
        keyword,
        snapshotDate,
        explanation: explanationResult.explanation,
      });
    }

    if (explanationResult.error) {
      console.error(`[Scheduler] "${keyword}" 종합점수 설명 생성 실패(스냅샷 저장에는 영향 없음):`, explanationResult.error);
    }
  } catch (error) {
    console.error(`[Scheduler] "${keyword}" 종합점수 설명 생성 예기치 못한 실패(스냅샷 저장에는 영향 없음):`, error.message);
  }
}

/**
 * 키워드 하나에 대해 YouTube -> 뉴스 -> 네이버 -> 종합점수 스냅샷 순서로
 * 수집합니다. 소스 하나가 실패해도(개별 try/catch) 나머지 소스는 계속
 * 진행합니다 - 실패는 로그로만 남기고, 자격증명 값은 각 소스 모듈이 이미
 * sanitize한 에러만 전달하므로 그대로 로그에 남겨도 안전합니다
 * (naverTrendGrowth.js의 toSanitizedNaverError() 등 기존 원칙 그대로 적용).
 * @param {string} keyword
 */
async function collectAllSourcesForKeyword(keyword) {
  try {
    await collectYoutubeForKeyword(keyword);
  } catch (error) {
    console.error(`[Scheduler] "${keyword}" YouTube 수집 실패(다음 소스로 계속 진행):`, error.message);
  }

  try {
    await collectNewsForKeyword(keyword);
  } catch (error) {
    console.error(`[Scheduler] "${keyword}" 뉴스 수집 실패(다음 소스로 계속 진행):`, error.message);
  }

  try {
    await collectNaverForKeyword(keyword);
  } catch (error) {
    console.error(`[Scheduler] "${keyword}" 네이버 조회 실패(다음 소스로 계속 진행):`, error.message);
  }

  try {
    await saveCompositeSnapshotForKeyword(keyword);
  } catch (error) {
    console.error(`[Scheduler] "${keyword}" 종합점수 스냅샷 저장 실패(다음 키워드로 계속 진행):`, error.message);
  }
}

/**
 * tracked_keywords의 is_active=true 키워드 전부에 대해 YouTube/뉴스/네이버
 * 수집을 순차적으로(병렬 아님 - 네이버/향후 Gemini 무료 할당량 보호)
 * 실행합니다. 이전 사이클이 아직 끝나지 않았다면 이번 실행은 건너뜁니다.
 * 키워드 목록 조회 자체가 실패해도(Supabase 미설정 등) 예외를 밖으로
 * 던지지 않고 로그만 남깁니다(setInterval 콜백 안전성 - trendMonitor.js와
 * 동일한 이유).
 */
export async function runScheduledCollection() {
  if (isRunning) {
    console.log("[Scheduler] 이전 작업이 아직 실행 중이라 이번 주기는 건너뜁니다.");
    return;
  }

  isRunning = true;
  console.log("[Scheduler] 시작");

  // 8-0단계: 수집 루프 시작 직전에 "자동 발견" 단계를 끼워 넣습니다.
  // 만료 처리/발견 둘 다 독립적인 try/catch로 감싸서, 여기서 무엇이
  // 실패하든(Supabase 오류, 카테고리 수집 실패 등) 아래 기존 사용자
  // 키워드 수집 루프는 항상 정상 진행됩니다. collectTrends나 기존 수집
  // 로직 자체는 이 블록에서 전혀 수정하지 않습니다.
  try {
    await expireAutoKeywords();
  } catch (error) {
    console.error("[Scheduler] 자동 키워드 만료 처리 실패(수집은 계속 진행):", error.message);
  }

  try {
    await discoverTrendingKeywords();
  } catch (error) {
    console.error("[Scheduler] 자동 키워드 발견 단계 실패(수집은 계속 진행):", error.message);
  }

  try {
    const keywords = await listActiveTrackedKeywords();
    console.log(`[Scheduler] 활성 키워드 ${keywords.length}개 수집 시작`);

    for (const { keyword } of keywords) {
      const timeout = createTimeoutRejection(
        PER_KEYWORD_TIMEOUT_MS,
        `"${keyword}" 처리가 상한 시간(${PER_KEYWORD_TIMEOUT_MS}ms)을 초과했습니다.`
      );
      try {
        await Promise.race([collectAllSourcesForKeyword(keyword), timeout.promise]);
      } catch (error) {
        console.error(`[Scheduler] "${keyword}" 처리 실패(다음 키워드로 계속 진행):`, error.message);
      } finally {
        timeout.cancel();
      }
    }

    console.log("[Scheduler] 전체 키워드 수집 완료");
  } catch (error) {
    console.error("[Scheduler] 실패:", error.message);
  } finally {
    isRunning = false;
    console.log("[Scheduler] 종료");
  }
}
