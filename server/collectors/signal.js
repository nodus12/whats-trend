// 19-2: 공통 Trend Signal 타입 정의 (19-1 분석에서 제안한 공통 데이터 모델)
//
// 이번 단계에서는 이 타입을 실제 파이프라인(aggregateTrends 등)에 강제하지
// 않습니다. newsCollector.js가 향후(19-3 이후) 다른 소스와 공통 형태로
// 합치기 위해 준비해두는 "정의"일 뿐이며, 현재 trendAggregator.js의 입력
// 형식({title, link, pubDate, source}[])은 그대로 유지됩니다.

/**
 * @typedef {Object} TrendSignal
 * @property {string} source - 신호 출처 (예: "news", "naver_datalab", "community")
 * @property {string} sourceType - 신호의 의미 범주
 *   ("exposure"=매체 노출, "demand"=검색 수요, "buzz"=커뮤니티 초기 신호, "diffusion"=SNS 확산)
 * @property {string} [keyword] - 이미 키워드 단위로 오는 소스(검색지수형)만 채움
 * @property {string} [text] - 원문 텍스트(뉴스 제목, 커뮤니티 글 제목 등)만 채움
 * @property {string} [url] - 원본 링크
 * @property {number} value - 이 신호의 "양"을 나타내는 수치. 소스마다 스케일이
 *   다르므로 서로 다른 source의 value를 직접 합산해서는 안 됩니다.
 * @property {number} collectedAt - 수집 시각(epoch ms)
 */

/**
 * 주어진 값이 TrendSignal의 최소 형태를 만족하는지 확인합니다.
 * (현재 파이프라인에서는 아직 사용하지 않으며, 19-3 이후 다중 소스를
 * 다룰 때를 위한 검증 헬퍼입니다.)
 *
 * @param {*} signal
 * @returns {boolean}
 */
export function isValidTrendSignal(signal) {
  if (!signal || typeof signal !== "object") {
    return false;
  }

  if (typeof signal.source !== "string" || signal.source.trim().length === 0) {
    return false;
  }

  if (typeof signal.sourceType !== "string" || signal.sourceType.trim().length === 0) {
    return false;
  }

  if (typeof signal.value !== "number" || !Number.isFinite(signal.value)) {
    return false;
  }

  if (typeof signal.collectedAt !== "number" || !Number.isFinite(signal.collectedAt)) {
    return false;
  }

  if (signal.keyword !== undefined && typeof signal.keyword !== "string") {
    return false;
  }

  if (signal.text !== undefined && typeof signal.text !== "string") {
    return false;
  }

  if (signal.url !== undefined && typeof signal.url !== "string") {
    return false;
  }

  return true;
}
