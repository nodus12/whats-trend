// 18-1: 자동 트렌드 감시 스케줄러
//
// server.js는 파일 최상단에서 app.listen()을 호출하는 부작용이 있어
// (그 파일을 그냥 import하기만 해도 실제 서버가 뜨고 실제 RSS 네트워크 요청이
// 발생합니다), 감시 로직을 server.js 안에만 두면 테스트에서 이 로직만 따로
// 불러와 검증할 방법이 없습니다. 그래서 "무엇을 수집하고, 얼마나 자주,
// 어떻게 실행할지"에 대한 순수 로직만 이 파일로 분리했습니다.
// setInterval 자체의 등록/해제(서버 시작 시점과의 연결)는 여전히
// server.js가 담당합니다 — 이 파일은 스케줄을 스스로 시작하지 않습니다.
import { getCollector, collectors } from "./collectors/index.js";
import { aggregateTrends } from "./trendAggregator.js";
import { checkTrendsAndNotify } from "./trendNotifier.js";
import { toCleanKeywordCandidates } from "./keywordFiltering.js";
import { runMultiSignalEngine } from "./multiSignalTrendEngine.js";

// 19-2: 데이터 수집은 이제 rss.js를 직접 호출하지 않고 Collector Registry를
// 거칩니다. newsCollector.collect()는 내부적으로 기존 fetchGoogleNews()를
// 그대로 호출하므로 반환 형태와 동작은 이전과 완전히 동일합니다. 이 배선
// 지점을 collector 기반으로 바꿔두면, 향후 다른 소스를 추가할 때 이 파일을
// 다시 고치지 않고 collectors/index.js에 등록만 하면 됩니다.
//
// 19-9: collectTrends()가 반환하는 기존 News 기반 trends는 절대 건드리지
// 않고, Multi-Signal Engine(19-8) 결과를 "추가 metadata"로만 덧붙입니다.
// News 외 source(Naver DataLab/Google Trends 등)는 인증 미설정/네트워크
// 오류로 언제든 실패할 수 있으므로 Promise.allSettled()로 격리하고, 이
// 계층 전체가 예기치 않게 실패해도 기존 News 기반 trends를 그대로
// 반환합니다 - Multi-Signal 계층은 기존 파이프라인의 필수 전제조건이
// 아니라 "있으면 더 풍부한" 선택적 보강 계층입니다.

// 감시 주기: 정확히 10분.
// trendHistory.js의 TREND_HISTORY_MIN_INTERVAL_MS(5분)보다 충분한 여유를 두어,
// 실행 시각이 약간 지연되더라도 매 주기가 유효한 스냅샷으로 기록되게 합니다.
export const TREND_MONITOR_INTERVAL_MS = 10 * 60 * 1000;

// 기존 /api/trends, /api/news, /api/push/check-trends와 동일한 기본 쿼리입니다.
export const DEFAULT_TREND_QUERY = "AI";

let isRunning = false;

/**
 * 현재 자동 감시 사이클이 실행 중인지 확인합니다.
 * (GET /api/trends가 자동 감시와 같은 순간 겹칠 때 중복 알림 검사를
 *  피하기 위한 용도로 server.js에서 사용합니다.)
 * @returns {boolean}
 */
export function isTrendMonitorRunning() {
  return isRunning;
}

/**
 * GET /api/trends와 자동 감시가 공통으로 사용하는 트렌드 수집 로직입니다.
 * 두 진입점이 서로 다른 구현을 갖지 않도록 반드시 이 함수 하나만 사용합니다.
 *
 * @param {string} [query]
 * @param {Object} [options]
 * @param {Date} [options.now] - 기준 시각(테스트용, 생략 시 현재 시각). aggregateTrends()의
 *   growth 계산 및 signal_history 조회/기록에 그대로 전달됩니다.
 * @returns {Promise<{items: Array, trends: Array}>}
 */
/**
 * News 외 source(현재 registry에 등록된 naver_datalab/google_trends 등)에서
 * 같은 query에 대한 Signal을 수집합니다. News 기사(newsItems)는 이미
 * collectTrends()가 가져온 것을 그대로 재사용합니다(중복 네트워크 요청 없음).
 *
 * 개별 source가 실패해도(인증 미설정, API 오류, timeout 등) 나머지 source와
 * News 기반 파이프라인에는 전혀 영향을 주지 않도록 Promise.allSettled()로
 * 격리합니다. 실패한 source는 로그만 남기고 이번 계산에서 조용히 제외됩니다
 * (fake data로 대체하지 않습니다 - 접근 불가능하면 그냥 "이번엔 없음"으로 처리).
 *
 * @param {string} query
 * @param {Array<Object>} newsItems
 * @param {Date} [now] - 기준 시각(테스트용, 생략 시 현재 시각)
 * @returns {Promise<Map<string, Object>>} keyword(소문자 비교용) -> Multi-Signal Trend 결과
 */
async function gatherMultiSignalResults(query, newsItems, now) {
  // newsCollector.toTrendSignals()는 한 배치의 모든 기사에 동일한
  // collectedAt(Date.now() 1회 호출)을 부여합니다(19-2 설계 - 배치 단위
  // 시각이면 충분했기 때문). 하지만 19-6의 dedupe 키(source+sourceType+
  // keyword+collectedAt)가 이 값을 그대로 쓰면, 같은 주기에 수집된 서로
  // 다른 기사 2개가 같은 키워드를 언급해도 "완전히 동일한 candidate"로
  // 오인되어 occurrence(몇 건의 기사가 언급했는지)가 실제보다 적게
  // 집계됩니다. newsCollector.js 자체는 바꾸지 않고, 여기서만 기사별로
  // 구분 가능하도록 collectedAt에 배열 인덱스를 더해 dedupe 충돌을 막습니다
  // (signal_history 기록에는 이 값이 쓰이지 않으므로 다른 영향은 없습니다 -
  // runMultiSignalEngine은 options.now를 기준으로 별도 timestamp를 사용합니다).
  const newsSignals = getCollector("news")
    .toTrendSignals(newsItems)
    .map((signal, index) => ({ ...signal, collectedAt: signal.collectedAt + index }));

  const otherSourceNames = Object.keys(collectors).filter((name) => name !== "news");
  const settled = await Promise.allSettled(otherSourceNames.map((name) => collectors[name].collect(query)));

  const otherSignals = [];
  settled.forEach((result, index) => {
    const sourceName = otherSourceNames[index];
    if (result.status === "fulfilled") {
      otherSignals.push(...result.value);
    } else {
      // Client Secret/API Key 등은 이 시점에 이미 sanitize된 error만 남아
      // 있으므로(각 collector의 toSanitized*Error 참고) 그대로 로그에
      // 남겨도 안전합니다.
      console.error(
        `[Trend Monitor] ${sourceName} signal 수집 실패(무시하고 계속 진행):`,
        result.reason?.message ?? result.reason
      );
    }
  });

  const cleanCandidates = toCleanKeywordCandidates([...newsSignals, ...otherSignals]);

  let multiSignalResults = [];
  try {
    multiSignalResults = runMultiSignalEngine(cleanCandidates, now instanceof Date ? { now } : {});
  } catch (error) {
    console.error("[Trend Monitor] Multi-Signal Engine 실행 실패(무시하고 계속 진행):", error?.message ?? error);
  }

  const byLowerKeyword = new Map();
  for (const result of multiSignalResults) {
    // News 쪽 keyword는 tokenizeTitle()이 소문자화하지만, Naver DataLab/
    // Google Trends 같은 explicit keyword는 원문 대소문자를 보존합니다
    // (19-7에서 이미 확인된 알려진 차이). 여기서는 병합 목적의 비교에만
    // 소문자 키를 쓰고, 실제 trend/signal 객체의 keyword 값 자체는 바꾸지 않습니다.
    byLowerKeyword.set(String(result.keyword).toLowerCase(), result);
  }

  return byLowerKeyword;
}

/**
 * 기존 News 기반 trend 배열에 Multi-Signal Trend metadata를 "추가"합니다.
 * 매칭되는 결과가 없는 trend는 원본 객체를 그대로 반환하고(필드 변경 없음),
 * 매칭되는 trend에는 기존 필드를 전부 유지한 채 multiSignalScore 등 새
 * 필드만 덧붙입니다 - 기존 필드의 이름/의미/타입은 절대 바꾸지 않습니다.
 *
 * @param {Array<Object>} trends
 * @param {Map<string, Object>} multiSignalByLowerKeyword
 * @returns {Array<Object>}
 */
function attachMultiSignalMetadata(trends, multiSignalByLowerKeyword) {
  return trends.map((trend) => {
    const matched = multiSignalByLowerKeyword.get(String(trend.keyword).toLowerCase());

    if (!matched) {
      return trend;
    }

    return {
      ...trend,
      multiSignalScore: matched.multiSignalScore,
      signalCoverage: matched.signalCoverage,
      signalAgreement: matched.signalAgreement,
      earlySignalScore: matched.earlySignalScore,
      mainstreamScore: matched.mainstreamScore,
      signals: matched.signals,
    };
  });
}

export async function collectTrends(query = DEFAULT_TREND_QUERY, options = {}) {
  const now = options.now instanceof Date ? options.now : undefined;
  const items = await getCollector("news").collect(query);
  const trends = now ? aggregateTrends(items, query, now) : aggregateTrends(items, query);

  let enrichedTrends = trends;
  try {
    const multiSignalByLowerKeyword = await gatherMultiSignalResults(query, items, now);
    enrichedTrends = attachMultiSignalMetadata(trends, multiSignalByLowerKeyword);
  } catch (error) {
    // Multi-Signal 계층 전체가 예기치 않게 실패해도 기존 News 기반 trends는
    // 그대로 반환합니다(위 gatherMultiSignalResults()가 이미 대부분의
    // 실패를 내부적으로 흡수하므로, 이 catch는 최후의 안전망입니다).
    console.error("[Trend Monitor] Multi-Signal 연결 실패(News 기반 결과는 정상 반환):", error?.message ?? error);
    enrichedTrends = trends;
  }

  return { items, trends: enrichedTrends };
}

/**
 * 자동 감시 한 사이클을 실행합니다.
 * - 이전 사이클이 아직 끝나지 않았다면 이번 실행은 건너뜁니다(중복 실행 방지).
 * - RSS 실패 등 어떤 오류가 발생해도 예외를 밖으로 던지지 않고 로그만 남깁니다.
 *   (setInterval 콜백에서 예외가 나면 다음 주기 실행에 영향을 줄 수 있으므로,
 *    이 함수 내부에서 반드시 잡아서 서버 프로세스에 영향이 없게 합니다.)
 * - 빈 RSS 결과(trends.length === 0)도 정상 상황으로 처리합니다.
 *
 * VAPID private key, Push subscription endpoint 등 민감정보는 로그에
 * 출력하지 않습니다(checkTrendsAndNotify/pushSender 쪽 로그도 이미 그렇게 구현되어 있음).
 */
export async function runTrendMonitorCycle() {
  if (isRunning) {
    console.log("[Trend Monitor] 이전 작업이 아직 실행 중이라 이번 주기는 건너뜁니다.");
    return;
  }

  isRunning = true;
  console.log("[Trend Monitor] 시작");

  try {
    const { trends } = await collectTrends(DEFAULT_TREND_QUERY);
    console.log(`[Trend Monitor] 트렌드 수집 완료: ${trends.length}개`);

    const result = await checkTrendsAndNotify(trends);
    console.log(
      `[Trend Monitor] 알림 검사 완료 (matched: ${result.matched}, notified: ${result.notified}, sent: ${result.sent}, failed: ${result.failed})`
    );
  } catch (error) {
    console.error("[Trend Monitor] 실패:", error.message);
  } finally {
    isRunning = false;
    console.log("[Trend Monitor] 종료");
  }
}
