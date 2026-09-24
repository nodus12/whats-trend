// 21-2 (2-1단계): YouTube 일별 트렌드 성장률(3d/7d/30d) 계산
//
// youtube_daily_trends(Supabase)에 이미 쌓인 일별 video_count만 읽어서
// 비교합니다. 이 모듈은 YouTube Data API를 전혀 호출하지 않습니다 -
// /api/youtube/trend가 매 호출마다 저장해두는 일별 스냅샷을 "읽어서
// 비교"만 하는 역할입니다. 기존 /api/youtube/trend, calculateYoutubeTrend(),
// saveYoutubeDailyTrend()는 이 파일에서 전혀 건드리지 않습니다.
import { getSupabaseClient, isSupabaseConfigured } from "./supabase.js";

export const YOUTUBE_DAILY_TRENDS_TABLE = "youtube_daily_trends";
const GROWTH_PERIODS = [3, 7, 30];

/**
 * "YYYY-MM-DD" 문자열에서 UTC 기준 N일 전 날짜를 "YYYY-MM-DD"로 계산합니다.
 * 월/연도 경계도 Date의 UTC setter가 안전하게 처리합니다.
 * @param {string} dateStr
 * @param {number} days
 * @returns {string}
 */
function subtractUtcDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * 상승률(%)을 계산합니다. compareCount가 0이면 나눗셈이 정의되지 않으므로
 * (0으로 나누기) null을 반환합니다 - 이 경우는 호출부에서 dataQuality를
 * "unreliable"로 표시합니다(0을 기준으로 한 퍼센트 변화는 수학적으로
 * 의미가 없으므로, "정상 계산됨"을 뜻하는 "ok"로 표시하지 않습니다).
 * 기존 trendAggregator.calculateGrowthRate()와 동일하게 소수점 1자리로
 * 반올림합니다.
 * @param {number} todayCount
 * @param {number} compareCount
 * @returns {number|null}
 */
function calculateRate(todayCount, compareCount) {
  if (compareCount === 0) {
    return null;
  }
  return Math.round(((todayCount - compareCount) / compareCount) * 1000) / 10;
}

/**
 * 특정 keyword+collected_date의 row 하나를 조회합니다(정확히 일치하는
 * 날짜만 - 근사치로 대체하지 않습니다).
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 * @param {string} keyword
 * @param {string} collectedDate - YYYY-MM-DD
 * @returns {Promise<{collected_date:string, video_count:number, capped:boolean}|null>}
 */
async function fetchRow(client, keyword, collectedDate) {
  const { data, error } = await client
    .from(YOUTUBE_DAILY_TRENDS_TABLE)
    .select("collected_date, video_count, capped")
    .eq("keyword", keyword)
    .eq("collected_date", collectedDate)
    .limit(1);

  if (error) {
    const sanitized = new Error(`Supabase 조회 실패: ${error.message ?? "unknown_error"}`);
    sanitized.code = "supabase_query_failed";
    throw sanitized;
  }

  return Array.isArray(data) && data.length > 0 ? data[0] : null;
}

/**
 * keyword의 가장 최근 저장된 일별 데이터("오늘")를 기준으로, 3일/7일/30일
 * 전 대비 상승률을 계산합니다. YouTube API 호출 없이 Supabase 조회만
 * 발생합니다.
 *
 * @param {string} query - keyword
 * @returns {Promise<{
 *   keyword: string,
 *   today: {date:string, video_count:number, capped:boolean},
 *   growth: Record<"3d"|"7d"|"30d", {compareDate:string|null, compareCount:number|null, rate:number|null, dataQuality:"ok"|"unreliable"|"insufficient_data"}>
 * }>}
 */
export async function calculateYoutubeTrendGrowth(query) {
  if (!query || typeof query !== "string" || !query.trim()) {
    const error = new Error("keyword가 필요합니다.");
    error.code = "trend_growth_invalid_query";
    throw error;
  }

  if (!isSupabaseConfigured()) {
    const error = new Error("Supabase가 설정되지 않아 성장률을 계산할 수 없습니다.");
    error.code = "supabase_not_configured";
    throw error;
  }

  const keyword = query.trim();
  const client = getSupabaseClient();

  const { data: latestRows, error: latestError } = await client
    .from(YOUTUBE_DAILY_TRENDS_TABLE)
    .select("collected_date, video_count, capped")
    .eq("keyword", keyword)
    .order("collected_date", { ascending: false })
    .limit(1);

  if (latestError) {
    const sanitized = new Error(`Supabase 조회 실패: ${latestError.message ?? "unknown_error"}`);
    sanitized.code = "supabase_query_failed";
    throw sanitized;
  }

  if (!Array.isArray(latestRows) || latestRows.length === 0) {
    const error = new Error(`keyword "${keyword}"에 대한 수집 데이터가 없습니다.`);
    error.code = "trend_growth_no_data";
    throw error;
  }

  const today = latestRows[0];
  const growth = {};

  for (const days of GROWTH_PERIODS) {
    const compareDate = subtractUtcDays(today.collected_date, days);
    const compareRow = await fetchRow(client, keyword, compareDate);

    if (!compareRow) {
      growth[`${days}d`] = {
        compareDate: null,
        compareCount: null,
        rate: null,
        dataQuality: "insufficient_data",
      };
      continue;
    }

    const rate = calculateRate(today.video_count, compareRow.video_count);
    const eitherCapped = Boolean(today.capped) || Boolean(compareRow.capped);
    const dataQuality = rate === null ? "unreliable" : eitherCapped ? "unreliable" : "ok";

    growth[`${days}d`] = {
      compareDate: compareRow.collected_date,
      compareCount: compareRow.video_count,
      rate,
      dataQuality,
    };
  }

  return {
    keyword,
    today: {
      date: today.collected_date,
      video_count: today.video_count,
      capped: Boolean(today.capped),
    },
    growth,
  };
}

// 21-2 (2-2단계): 3d/7d/30d 상승률을 가중 평균해 단일 trendScore로 만듭니다.
// calculateYoutubeTrendGrowth()가 이미 계산한 growth 객체를 입력으로만
// 받는 순수 함수입니다 - Supabase 조회를 다시 하지 않고, 위 함수의 계산
// 로직도 전혀 수정하지 않았습니다.
const TREND_SCORE_BASE_WEIGHTS = { "3d": 0.5, "7d": 0.3, "30d": 0.2 };
const TREND_SCORE_PERIODS = ["3d", "7d", "30d"];

/**
 * 기간별 effective weight를 정합니다.
 * - "ok": 기본 가중치 그대로
 * - "unreliable": 기본 가중치의 절반(나머지 절반은 재분배 대상)
 * - "insufficient_data"(또는 알 수 없는 값): 0(계산에서 완전히 제외)
 * @param {string} dataQuality
 * @param {number} baseWeight
 * @returns {number}
 */
function resolveEffectiveWeight(dataQuality, baseWeight) {
  if (dataQuality === "ok") {
    return baseWeight;
  }
  if (dataQuality === "unreliable") {
    return baseWeight / 2;
  }
  return 0;
}

/**
 * growth 객체(calculateYoutubeTrendGrowth()의 결과 중 growth 필드)를 받아
 * trendScore를 계산합니다.
 *
 * 재분배 방식: 각 기간의 effective weight(ok=기본값, unreliable=기본값/2,
 * insufficient_data=0)를 구한 뒤, 그 합으로 각 effective weight를 나눠
 * 정규화합니다(합이 1이 되도록) - "제외/절반으로 줄어든 만큼"이 자동으로
 * 나머지 기간에 비례 재분배되는 효과를 냅니다(별도의 재분배 계산식을
 * 따로 두지 않음).
 *
 * @param {Record<"3d"|"7d"|"30d", {rate:number|null, dataQuality:string}>} growth
 * @returns {{value:number|null, dataQuality:"ok"|"partial_unreliable"|"insufficient_data", weightsUsed:Record<"3d"|"7d"|"30d", number>}}
 */
export function calculateTrendScore(growth) {
  const effectiveWeights = {};

  for (const period of TREND_SCORE_PERIODS) {
    const quality = growth?.[period]?.dataQuality;
    effectiveWeights[period] = resolveEffectiveWeight(quality, TREND_SCORE_BASE_WEIGHTS[period]);
  }

  const sumEffective = TREND_SCORE_PERIODS.reduce((sum, period) => sum + effectiveWeights[period], 0);

  if (sumEffective === 0) {
    return {
      value: null,
      dataQuality: "insufficient_data",
      weightsUsed: { "3d": 0, "7d": 0, "30d": 0 },
    };
  }

  const finalWeights = {};
  let weightedSum = 0;

  for (const period of TREND_SCORE_PERIODS) {
    finalWeights[period] = effectiveWeights[period] / sumEffective;

    if (growth?.[period]?.dataQuality !== "insufficient_data") {
      weightedSum += finalWeights[period] * growth[period].rate;
    }
  }

  const hasUnreliable = TREND_SCORE_PERIODS.some((period) => growth?.[period]?.dataQuality === "unreliable");

  return {
    value: Math.round(weightedSum * 10) / 10,
    dataQuality: hasUnreliable ? "partial_unreliable" : "ok",
    weightsUsed: {
      "3d": Math.round(finalWeights["3d"] * 1000) / 1000,
      "7d": Math.round(finalWeights["7d"] * 1000) / 1000,
      "30d": Math.round(finalWeights["30d"] * 1000) / 1000,
    },
  };
}
