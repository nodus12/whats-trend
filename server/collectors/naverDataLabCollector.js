// 19-3: Naver DataLab 검색어트렌드 API Collector
//
// 공식 스펙(확인 출처는 19-3 완료 보고서 "1. 공식 API 확인" 참고):
//   - POST https://openapi.naver.com/v1/datalab/search
//   - 헤더: X-Naver-Client-Id, X-Naver-Client-Secret, Content-Type: application/json
//   - body: { startDate, endDate, timeUnit("date"|"week"|"month"), keywordGroups:[{groupName, keywords[]}] }
//     (keywordGroups 최대 5개, 각 keywords 최대 20개, startDate는 2016-01-01 이후만 가능)
//   - 응답: { results: [{ title, keywords, data: [{ period, ratio }] }] }
//     ratio는 조회 구간 내 최고점을 100으로 정규화한 상대 검색량입니다(절대 검색 건수가 아님).
//
// 이 파일은 News RSS(server/rss.js)와 완전히 다른 소스이므로, 기존
// aggregateTrends(newsItems)에 억지로 끼워 넣지 않습니다. collect()는
// server/collectors/signal.js의 공통 TrendSignal 형태로 이미 정규화된
// 결과만 반환합니다 - News의 {title, link, pubDate, source}[]와는 다른 형태입니다.
//
// 보안: NAVER_CLIENT_ID/NAVER_CLIENT_SECRET은 process.env에서만 읽고,
// 코드에 하드코딩하지 않습니다. 오류를 다룰 때도 axios 에러 객체를 그대로
// 전파하지 않습니다 - error.config에는 요청 헤더(Client Secret 포함)가
// 그대로 담겨 있어, 그대로 로그로 남기거나 상위로 전달하면 Secret이 노출될
// 수 있기 때문입니다. 대신 상태 코드/메시지만 뽑아낸 새 Error만 던집니다.
import axios from "axios";

const NAVER_DATALAB_URL = "https://openapi.naver.com/v1/datalab/search";
export const NAVER_SOURCE = "naver_datalab";

/**
 * 인증 정보(Client ID/Secret)가 환경변수에 설정되어 있는지 확인합니다.
 * @returns {boolean}
 */
export function isNaverConfigured() {
  return Boolean(process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET);
}

function formatDate(date) {
  return date.toISOString().slice(0, 10); // yyyy-mm-dd
}

/**
 * axios 에러에서 Client Secret이 포함될 수 있는 정보(error.config 등)를
 * 걷어내고, 상태 코드/메시지만 담은 안전한 Error를 만듭니다.
 * @param {*} error
 * @returns {Error & {statusCode: number|null, code: string}}
 */
function toSanitizedNaverError(error) {
  const statusCode =
    error && error.response && typeof error.response.status === "number" ? error.response.status : null;

  const sanitized = new Error(
    statusCode
      ? `Naver DataLab API 요청 실패 (status ${statusCode})`
      : `Naver DataLab API 요청 실패: ${error?.message ?? "unknown_error"}`
  );
  sanitized.statusCode = statusCode;
  sanitized.code = "naver_request_failed";
  return sanitized;
}

/**
 * Naver DataLab 검색어트렌드 API를 실제로 호출합니다.
 * 인증 정보가 없으면 네트워크 요청을 아예 시도하지 않고 즉시 실패합니다.
 *
 * @param {string} keyword - 단일 키워드(현재 버전은 keywordGroups 1개, keywords 1개만 사용)
 * @param {Object} [options]
 * @param {Date} [options.now] - 기준 시각(테스트용, 생략 시 현재 시각)
 * @param {number} [options.rangeDays=7] - startDate를 now 기준 며칠 전으로 잡을지
 * @returns {Promise<Object>} Naver DataLab 원본 응답 JSON
 */
export async function fetchNaverDataLab(keyword, options = {}) {
  if (!keyword || typeof keyword !== "string") {
    throw new Error("Naver DataLab 요청에는 유효한 keyword 문자열이 필요합니다.");
  }

  if (!isNaverConfigured()) {
    const error = new Error(
      "Naver DataLab API 인증 정보(NAVER_CLIENT_ID/NAVER_CLIENT_SECRET)가 설정되지 않았습니다."
    );
    error.code = "naver_not_configured";
    throw error;
  }

  const now = options.now instanceof Date ? options.now : new Date();
  const rangeDays = typeof options.rangeDays === "number" ? options.rangeDays : 7;
  const endDate = formatDate(now);
  const startDate = formatDate(new Date(now.getTime() - rangeDays * 24 * 60 * 60 * 1000));

  try {
    const response = await axios.post(
      NAVER_DATALAB_URL,
      {
        startDate,
        endDate,
        timeUnit: "date",
        keywordGroups: [{ groupName: keyword, keywords: [keyword] }],
      },
      {
        headers: {
          "X-Naver-Client-Id": process.env.NAVER_CLIENT_ID,
          "X-Naver-Client-Secret": process.env.NAVER_CLIENT_SECRET,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );

    return response.data;
  } catch (error) {
    throw toSanitizedNaverError(error);
  }
}

/**
 * Naver DataLab 원본 응답을 공통 TrendSignal로 변환합니다.
 * 응답 구조가 예상과 다르거나(잘못된 JSON, 빈 data) 유효한 ratio가 없으면
 * 예외를 던지지 않고 null을 반환합니다 - 이 신호가 "이번엔 데이터가 없었다"는
 * 뜻이며, 상위 코드가 안전하게 건너뛸 수 있게 하기 위함입니다.
 *
 * @param {*} raw - fetchNaverDataLab()의 원본 응답(또는 임의의 값)
 * @param {string} keyword
 * @param {number} [collectedAt]
 * @returns {import('./signal.js').TrendSignal|null}
 */
export function normalizeNaverResponse(raw, keyword, collectedAt = Date.now()) {
  const group = raw && Array.isArray(raw.results) ? raw.results[0] : null;
  const dataPoints = group && Array.isArray(group.data) ? group.data : [];

  if (dataPoints.length === 0) {
    return null;
  }

  const latest = dataPoints[dataPoints.length - 1];

  if (!latest || typeof latest.ratio !== "number" || !Number.isFinite(latest.ratio)) {
    return null;
  }

  return {
    source: NAVER_SOURCE,
    sourceType: "demand",
    keyword,
    value: latest.ratio,
    collectedAt,
  };
}

/**
 * keyword 하나를 수집해 공통 TrendSignal 배열로 반환합니다(0개 또는 1개).
 * newsCollector.collect()와 동일하게 배열을 반환해 Collector 인터페이스를
 * 통일합니다. 이 단계에서는 아직 어떤 상위 파이프라인에도 연결되지 않으며,
 * signal_history 기록/growth 계산은 server/signalHistory.js가 별도로 담당합니다.
 *
 * @param {string} keyword
 * @param {Object} [options] - fetchNaverDataLab()에 그대로 전달됩니다.
 * @returns {Promise<Array<import('./signal.js').TrendSignal>>}
 */
async function collect(keyword, options = {}) {
  const collectedAt = Date.now();
  const raw = await fetchNaverDataLab(keyword, options);
  const signal = normalizeNaverResponse(raw, keyword, collectedAt);
  return signal ? [signal] : [];
}

export const naverDataLabCollector = {
  source: NAVER_SOURCE,
  collect,
  fetchNaverDataLab,
  normalizeNaverResponse,
  isNaverConfigured,
};
