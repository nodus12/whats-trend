// 19-4: Google Trends Collector
//
// 공식 문서 확인 결과(2026-09-16 기준, 근거는 19-4 완료 보고서 "1. Google Trends
// 공식 API 확인 결과" 참고): Google Trends API는 "Alpha" 단계이며, 신청을 통해
// 개별 승인받은 제한된 테스터에게만 접근이 열립니다. developers.google.com/
// search/apis/trends 페이지 자체가 endpoint URL, 인증 방식(API Key/OAuth 등),
// request/response 스키마를 전혀 공개하지 않습니다("we can't open the API for
// everyone yet"). 따라서 이 파일은 아래 두 가지를 절대 하지 않습니다:
//   1) 존재를 확인할 수 없는 endpoint/인증 방식을 "공식 스펙"인 것처럼 하드코딩
//   2) pytrends 등 비공식 스크래핑 라이브러리/내부 endpoint를 production 경로로 채택
//
// 대신, 실제 Alpha 접근 권한을 받은 뒤 공식 문서를 다시 확인해서 채워 넣을 수
// 있는 "자리(interface)"만 만들어 둡니다. GOOGLE_TRENDS_API_ENDPOINT /
// GOOGLE_TRENDS_API_KEY 둘 다 설정되지 않으면 네트워크 요청을 절대 시도하지
// 않고 즉시 명확한 오류로 실패합니다(server/collectors/naverDataLabCollector.js의
// isNaverConfigured() 패턴과 동일).
//
// 아래 fetchGoogleTrends()의 요청 형태(헤더 이름 "X-Goog-Api-Key", query
// parameter 등)는 공식 문서에서 확인된 것이 아니라 "실제 Alpha 접근이 열리면
// 이 함수 내부만 고쳐 끼워 넣기 위한 placeholder"입니다. 검증된 스펙이 아니므로
// 실제 연동 시 반드시 승인 시 제공되는 공식 문서를 다시 확인하고 교체해야 합니다.
import axios from "axios";

export const GOOGLE_TRENDS_SOURCE = "google_trends";

/**
 * 필수 환경변수(GOOGLE_TRENDS_API_ENDPOINT, GOOGLE_TRENDS_API_KEY)가
 * 설정되어 있는지 확인합니다. 두 값 모두 공식 Alpha 접근 승인 후에만
 * 실제 값을 채워 넣을 수 있습니다(현재 프로젝트에는 접근 권한이 없음).
 * @returns {boolean}
 */
export function isGoogleTrendsConfigured() {
  return Boolean(process.env.GOOGLE_TRENDS_API_ENDPOINT && process.env.GOOGLE_TRENDS_API_KEY);
}

/**
 * axios 에러에서 API Key가 포함될 수 있는 정보(error.config 등)를 걷어내고,
 * 상태 코드/메시지만 담은 안전한 Error를 만듭니다.
 * (server/collectors/naverDataLabCollector.js의 toSanitizedNaverError()와 동일한 이유)
 * @param {*} error
 * @returns {Error & {statusCode: number|null, code: string}}
 */
function toSanitizedGoogleTrendsError(error) {
  const statusCode =
    error && error.response && typeof error.response.status === "number" ? error.response.status : null;

  const isTimeout = error?.code === "ECONNABORTED";

  const sanitized = new Error(
    isTimeout
      ? "Google Trends API 요청 시간 초과(timeout)"
      : statusCode
        ? `Google Trends API 요청 실패 (status ${statusCode})`
        : `Google Trends API 요청 실패: ${error?.message ?? "unknown_error"}`
  );
  sanitized.statusCode = statusCode;
  sanitized.code = isTimeout ? "google_trends_timeout" : "google_trends_request_failed";
  return sanitized;
}

/**
 * Google Trends API를 호출합니다. (Case B: 공식 접근 권한 부재로 인한 placeholder)
 * 인증 정보가 설정되어 있지 않으면 네트워크 요청을 아예 시도하지 않고 즉시 실패합니다.
 *
 * @param {string} keyword
 * @param {Object} [options]
 * @param {number} [options.timeoutMs=10000]
 * @returns {Promise<Object>} Google Trends 원본 응답(형태 미확정 - placeholder)
 */
export async function fetchGoogleTrends(keyword, options = {}) {
  if (!keyword || typeof keyword !== "string") {
    throw new Error("Google Trends 요청에는 유효한 keyword 문자열이 필요합니다.");
  }

  if (!isGoogleTrendsConfigured()) {
    const error = new Error(
      "Google Trends API가 아직 연결되지 않았습니다. 공식 Alpha 접근 권한을 받은 뒤 " +
        "공식 문서를 확인하고 GOOGLE_TRENDS_API_ENDPOINT/GOOGLE_TRENDS_API_KEY를 설정하세요."
    );
    error.code = "google_trends_not_configured";
    throw error;
  }

  const timeout = typeof options.timeoutMs === "number" ? options.timeoutMs : 10000;

  try {
    // NOTE: 요청 형태(헤더/파라미터 이름)는 공식 문서 미공개로 인한 placeholder입니다.
    // 실제 Alpha 접근 시 공식 문서 기준으로 이 블록을 다시 확인/교체해야 합니다.
    const response = await axios.get(process.env.GOOGLE_TRENDS_API_ENDPOINT, {
      headers: {
        "X-Goog-Api-Key": process.env.GOOGLE_TRENDS_API_KEY,
      },
      params: { keyword },
      timeout,
    });

    return response.data;
  } catch (error) {
    throw toSanitizedGoogleTrendsError(error);
  }
}

/**
 * Google Trends 원본 응답을 공통 TrendSignal로 변환합니다.
 *
 * 중요: Google Trends 값(value)은 절대 검색량이 아니라 "search interest"
 * (상대적 검색 관심도 지수)입니다 - 공식 발표에서도 "the numbers don't reflect
 * absolute numbers, they reflect search interest"라고 명시합니다. 이 값을
 * UI 등에서 표시할 때도 "검색량"이 아니라 "검색 관심도(지수)"로 표현해야 합니다.
 *
 * 응답 구조 자체가 아직 공식적으로 확인되지 않았으므로(Case B), 이 함수는
 * "시계열 데이터 포인트 배열(data[].value)" 형태의 일반적인 가정 하에
 * 가장 최근 포인트 하나를 이번 수집의 대표 값으로 사용합니다. 예상과 다른
 * 구조/빈 데이터가 들어오면 예외 대신 null을 반환해 안전하게 건너뜁니다.
 *
 * @param {*} raw - fetchGoogleTrends()의 원본 응답(또는 임의의 값)
 * @param {string} keyword
 * @param {number} [collectedAt]
 * @returns {import('./signal.js').TrendSignal|null}
 */
export function normalizeGoogleTrendsResponse(raw, keyword, collectedAt = Date.now()) {
  const dataPoints = raw && Array.isArray(raw.data) ? raw.data : [];

  if (dataPoints.length === 0) {
    return null;
  }

  const latest = dataPoints[dataPoints.length - 1];

  if (!latest || typeof latest.value !== "number" || !Number.isFinite(latest.value)) {
    return null;
  }

  return {
    source: GOOGLE_TRENDS_SOURCE,
    sourceType: "demand",
    keyword,
    // search interest 지수(절대 검색량 아님) - 위 함수 설명 참고
    value: latest.value,
    collectedAt,
  };
}

/**
 * keyword 하나를 수집해 공통 TrendSignal 배열로 반환합니다(0개 또는 1개).
 * naverDataLabCollector.collect()/newsCollector.collect()와 동일하게
 * Collector 인터페이스(collect(query) -> Promise<Array>)를 통일합니다.
 * 이 단계에서는 어떤 상위 파이프라인(aggregateTrends, trendMonitor 등)에도
 * 연결되지 않으며, signal_history 기록/growth 계산은 server/signalHistory.js가
 * 필요할 때 별도로 호출해서 담당합니다.
 *
 * @param {string} keyword
 * @param {Object} [options] - fetchGoogleTrends()에 그대로 전달됩니다.
 * @returns {Promise<Array<import('./signal.js').TrendSignal>>}
 */
async function collect(keyword, options = {}) {
  const collectedAt = Date.now();
  const raw = await fetchGoogleTrends(keyword, options);
  const signal = normalizeGoogleTrendsResponse(raw, keyword, collectedAt);
  return signal ? [signal] : [];
}

export const googleTrendsCollector = {
  source: GOOGLE_TRENDS_SOURCE,
  collect,
  fetchGoogleTrends,
  normalizeGoogleTrendsResponse,
  isGoogleTrendsConfigured,
};
