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
import { listActiveTrackedKeywords } from "./trackedKeywords.js";

// 하루 3회 기준 8시간.
export const SCHEDULED_COLLECTION_INTERVAL_MS = 8 * 60 * 60 * 1000;

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
 * 키워드 하나에 대해 YouTube -> 뉴스 -> 네이버 순서로 수집합니다. 소스
 * 하나가 실패해도(개별 try/catch) 나머지 소스는 계속 진행합니다 - 실패는
 * 로그로만 남기고, 자격증명 값은 각 소스 모듈이 이미 sanitize한 에러만
 * 전달하므로 그대로 로그에 남겨도 안전합니다(naverTrendGrowth.js의
 * toSanitizedNaverError() 등 기존 원칙 그대로 적용).
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
    console.error(`[Scheduler] "${keyword}" 네이버 조회 실패(다음 키워드로 계속 진행):`, error.message);
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

  try {
    const keywords = await listActiveTrackedKeywords();
    console.log(`[Scheduler] 활성 키워드 ${keywords.length}개 수집 시작`);

    for (const { keyword } of keywords) {
      await collectAllSourcesForKeyword(keyword);
    }

    console.log("[Scheduler] 전체 키워드 수집 완료");
  } catch (error) {
    console.error("[Scheduler] 실패:", error.message);
  } finally {
    isRunning = false;
    console.log("[Scheduler] 종료");
  }
}
