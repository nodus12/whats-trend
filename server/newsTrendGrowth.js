// 3-1단계: 뉴스 일별 트렌드 성장률(3d/7d/30d) 계산
//
// server/youtubeTrendGrowth.js의 calculateYoutubeTrendGrowth()와 동일한
// 로직 구조를 복제했습니다(3/7/30일 비교, dataQuality: ok/unreliable/
// insufficient_data) - 차이는 오직 조회 대상 테이블(news_daily_trends)과
// 컬럼명(video_count -> mention_count)뿐입니다.
//
// calculateTrendScore()는 "소스 무관 범용 함수"이므로 복제하지 않고
// youtubeTrendGrowth.js에서 그대로 import해서 재사용합니다. 그 파일과
// server/rss.js, server/trendAggregator.js, server/trendHistory.js,
// server/signalHistory.js는 이 파일에서 전혀 수정하지 않았습니다.
import { getSupabaseClient, isSupabaseConfigured } from "./supabase.js";
import { calculateTrendScore } from "./youtubeTrendGrowth.js";
import { NEWS_DAILY_TRENDS_TABLE } from "./newsDailyTrend.js";

export { calculateTrendScore };

const GROWTH_PERIODS = [3, 7, 30];

/**
 * "YYYY-MM-DD" 문자열에서 UTC 기준 N일 전 날짜를 "YYYY-MM-DD"로 계산합니다.
 * youtubeTrendGrowth.js의 subtractUtcDays()와 동일한 로직입니다.
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
 * 상승률(%)을 계산합니다. compareCount가 0이면 null(unreliable로 처리).
 * youtubeTrendGrowth.js의 calculateRate()와 동일한 로직입니다.
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
 * 날짜만).
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 * @param {string} keyword
 * @param {string} collectedDate - YYYY-MM-DD
 * @returns {Promise<{collected_date:string, mention_count:number, capped:boolean}|null>}
 */
async function fetchRow(client, keyword, collectedDate) {
  const { data, error } = await client
    .from(NEWS_DAILY_TRENDS_TABLE)
    .select("collected_date, mention_count, capped")
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
 * keyword의 가장 최근 저장된 일별 뉴스 언급량("오늘")을 기준으로, 3일/7일/
 * 30일 전 대비 상승률을 계산합니다. news_daily_trends 조회만 발생하며,
 * RSS 호출은 하지 않습니다.
 *
 * @param {string} query - keyword
 * @returns {Promise<{
 *   keyword: string,
 *   today: {date:string, mention_count:number, capped:boolean},
 *   growth: Record<"3d"|"7d"|"30d", {compareDate:string|null, compareCount:number|null, rate:number|null, dataQuality:"ok"|"unreliable"|"insufficient_data"}>
 * }>}
 */
export async function calculateNewsTrendGrowth(query) {
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
    .from(NEWS_DAILY_TRENDS_TABLE)
    .select("collected_date, mention_count, capped")
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

    const rate = calculateRate(today.mention_count, compareRow.mention_count);
    const eitherCapped = Boolean(today.capped) || Boolean(compareRow.capped);
    const dataQuality = rate === null ? "unreliable" : eitherCapped ? "unreliable" : "ok";

    growth[`${days}d`] = {
      compareDate: compareRow.collected_date,
      compareCount: compareRow.mention_count,
      rate,
      dataQuality,
    };
  }

  return {
    keyword,
    today: {
      date: today.collected_date,
      mention_count: today.mention_count,
      capped: Boolean(today.capped),
    },
    growth,
  };
}
