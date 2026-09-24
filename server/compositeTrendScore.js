// 3-3단계: YouTube/뉴스/네이버 세 소스의 개별 Trend Score를 병렬로 모아
// 하나의 종합 점수로 합칩니다.
//
// 제약사항: calculateYoutubeTrendGrowth/calculateNewsTrendGrowth/
// getNaverTrendGrowth와 그 하위 파일(youtubeTrendGrowth.js,
// newsTrendGrowth.js, naverTrendGrowth.js, 그리고 그 아래의 모든 protected
// 파일들)은 이 파일에서 전혀 수정하지 않고 호출만 합니다.
//
// calculateTrendScore()는 "각 소스 하나의 growth(3d/7d/30d)를 하나의
// trendScore로 합치는" 용도로만 재사용합니다(youtube/news 소스 각각에
// 대해 - naver는 getNaverTrendGrowth가 이미 trendScore를 포함해서 줌).
// 이 파일에서 새로 만드는 것은 그것과 성격이 다른 "이미 계산된 소스별
// trendScore 3개를 소스 단위로 재분배하는" 로직입니다 - calculateTrendScore
// 내부 로직을 복제하지도, 그 함수를 이 목적에 재호출하지도 않습니다.
import { calculateYoutubeTrendGrowth, calculateTrendScore } from "./youtubeTrendGrowth.js";
import { calculateNewsTrendGrowth } from "./newsTrendGrowth.js";
import { getNaverTrendGrowth } from "./naverTrendGrowth.js";

const SOURCES = ["youtube", "news", "naver"];
// 기본 배분은 균등 1/3 - 3-3단계 지시사항의 "종합 점수 계산" 기본값.
const BASE_WEIGHT = 1 / 3;

/**
 * 소스 하나의 trendScore.dataQuality를 기준으로 effective weight를 정합니다.
 * calculateTrendScore()의 resolveEffectiveWeight()와 같은 3단계 개념(ok=전체,
 * partial_unreliable=절반, insufficient_data=0)을 쓰지만, 이건 "growth의
 * 기간(3d/7d/30d)"이 아니라 "소스(youtube/news/naver)" 단위로 적용하는
 * 별개의 재분배이므로 이 파일에 독립적으로 새로 작성했습니다.
 * @param {boolean} available
 * @param {string|undefined} dataQuality
 * @returns {number}
 */
function resolveSourceWeight(available, dataQuality) {
  if (!available) {
    return 0;
  }
  if (dataQuality === "ok") {
    return BASE_WEIGHT;
  }
  if (dataQuality === "partial_unreliable") {
    return BASE_WEIGHT / 2;
  }
  return 0; // insufficient_data 또는 알 수 없는 값
}

/**
 * calculateYoutubeTrendGrowth/calculateNewsTrendGrowth 결과(Promise.allSettled)를
 * sources.{youtube,news} 형태로 변환합니다. 두 함수는 실패 시 throw하는
 * 계약이므로(server/naverTrendGrowth.js 조사에서 코드로 확인됨), rejected면
 * 해당 소스를 "제외"로 표시하고 이유(error.code)만 로그에 남깁니다 - 응답
 * 자체를 실패시키지 않습니다.
 * @param {PromiseSettledResult<{growth:Object}>} settled
 * @param {string} sourceName
 * @param {string} fallbackReason
 * @returns {{available:boolean, trendScore?:Object, reason?:string}}
 */
function toSourceResult(settled, sourceName, fallbackReason) {
  if (settled.status === "fulfilled") {
    const trendScore = calculateTrendScore(settled.value.growth);
    return { available: true, trendScore };
  }

  console.error(`${sourceName} trend-growth 실패(종합 점수에서 제외):`, settled.reason?.message);
  return { available: false, reason: settled.reason?.code ?? fallbackReason };
}

/**
 * getNaverTrendGrowth 결과를 sources.naver 형태로 변환합니다.
 * getNaverTrendGrowth()는 API 실패 시에도 throw하지 않고
 * { error, growth: null, trendScore: null }을 반환하므로(naverTrendGrowth.js
 * 조사에서 확인됨), .error 필드 존재 여부로 판별합니다.
 * @param {{error?:string, trendScore?:Object}} naverResult
 * @returns {{available:boolean, trendScore?:Object, reason?:string}}
 */
function toNaverSourceResult(naverResult) {
  if (naverResult && naverResult.error) {
    return { available: false, reason: naverResult.error };
  }
  return { available: true, trendScore: naverResult.trendScore };
}

/**
 * 소스 3개의 trendScore를 가중 평균해 종합 점수를 만듭니다. effective
 * weight의 합으로 정규화하는 재분배 원리는 calculateTrendScore()와 같은
 * 개념이지만, 대상이 "기간"이 아니라 "소스"이므로 별도 구현입니다.
 *
 * dataQuality 3단계(ok/partial/insufficient_data)는 이 함수에서 새로
 * 정의하는 "소스 단위 가용성" 개념입니다 - calculateTrendScore()가 반환하는
 * growth 기간 단위의 ok/partial_unreliable/insufficient_data와 이름이
 * 비슷하지만 다른 개념이므로 혼동하지 않도록 주석으로 구분합니다:
 *   - "ok": 세 소스 전부 available이고 전부 자체 dataQuality가 "ok"
 *           (재분배가 전혀 필요 없었던 깨끗한 경우)
 *   - "partial": 일부 소스만 유효 가중치를 가짐(재분배가 일어남)
 *   - "insufficient_data": 세 소스 전부 유효 가중치 0(쓸 수 있는 값이 없음)
 *
 * @param {Record<"youtube"|"news"|"naver", {available:boolean, trendScore?:{value:number|null, dataQuality:string}}>} sources
 * @returns {{value:number|null, dataQuality:"ok"|"partial"|"insufficient_data", weightsUsed:Record<string, number>}}
 */
function computeCompositeScore(sources) {
  const effectiveWeights = {};

  for (const source of SOURCES) {
    const entry = sources[source];
    effectiveWeights[source] = resolveSourceWeight(entry.available, entry.trendScore?.dataQuality);
  }

  const sumEffective = SOURCES.reduce((sum, source) => sum + effectiveWeights[source], 0);

  if (sumEffective === 0) {
    return {
      value: null,
      dataQuality: "insufficient_data",
      weightsUsed: { youtube: 0, news: 0, naver: 0 },
    };
  }

  const finalWeights = {};
  let weightedSum = 0;

  for (const source of SOURCES) {
    finalWeights[source] = effectiveWeights[source] / sumEffective;

    const entry = sources[source];
    if (entry.available && entry.trendScore?.dataQuality !== "insufficient_data") {
      weightedSum += finalWeights[source] * entry.trendScore.value;
    }
  }

  const allFullyOk = SOURCES.every(
    (source) => sources[source].available && sources[source].trendScore?.dataQuality === "ok"
  );

  return {
    value: Math.round(weightedSum * 10) / 10,
    dataQuality: allFullyOk ? "ok" : "partial",
    weightsUsed: {
      youtube: Math.round(finalWeights.youtube * 1000) / 1000,
      news: Math.round(finalWeights.news * 1000) / 1000,
      naver: Math.round(finalWeights.naver * 1000) / 1000,
    },
  };
}

/**
 * keyword의 YouTube/뉴스/네이버 Trend Score를 병렬로 모아 종합 점수를
 * 계산합니다. 세 소스 중 무엇이 실패해도 이 함수는 throw하지 않습니다
 * (keyword 유효성 검증 실패만 예외) - 호출부(route)가 항상 HTTP 200으로
 * 응답할 수 있게 합니다.
 *
 * @param {string} query
 * @returns {Promise<{keyword:string, sources:Object, compositeScore:Object}>}
 */
export async function getCompositeTrendScore(query) {
  if (!query || typeof query !== "string" || !query.trim()) {
    const error = new Error("keyword가 필요합니다.");
    error.code = "composite_trend_score_invalid_query";
    throw error;
  }

  const keyword = query.trim();

  const [ytSettled, newsSettled] = await Promise.allSettled([
    calculateYoutubeTrendGrowth(keyword),
    calculateNewsTrendGrowth(keyword),
  ]);
  const naverResult = await getNaverTrendGrowth(keyword).catch((err) => {
    console.error("Naver trend-growth 예기치 못한 실패(종합 점수에서 제외):", err.message);
    return { error: "naver_invalid_query", growth: null, trendScore: null };
  });

  const sources = {
    youtube: toSourceResult(ytSettled, "YouTube", "youtube_unavailable"),
    news: toSourceResult(newsSettled, "News", "news_unavailable"),
    naver: toNaverSourceResult(naverResult),
  };

  const compositeScore = computeCompositeScore(sources);

  return { keyword, sources, compositeScore };
}
