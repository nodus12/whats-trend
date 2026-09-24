// 4-2단계: 종합점수 일별 스냅샷 저장 + 그래프용 히스토리 조회
//
// youtubeTrendGrowth.js, newsTrendGrowth.js, naverTrendGrowth.js,
// compositeTrendScore.js의 기존 계산 로직은 이 파일에서 전혀 수정하지
// 않습니다 - 이 파일은 이미 그 파일들이 다른 테이블(youtube_daily_trends,
// news_daily_trends, naver_trend_cache)에 저장해둔 값을 그대로 읽거나,
// compositeTrendScore.js가 계산한 결과를 새 테이블(composite_trend_snapshots)에
// 저장하는 것만 담당합니다. 계산 자체는 하지 않습니다(단순 조회/저장 전용).
import { getSupabaseClient, isSupabaseConfigured } from "./supabase.js";

export const COMPOSITE_SNAPSHOTS_TABLE = "composite_trend_snapshots";

const HISTORY_LIMIT_DAYS = 60;

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function historyCutoffDate() {
  return formatDate(new Date(Date.now() - HISTORY_LIMIT_DAYS * 24 * 60 * 60 * 1000));
}

/**
 * scheduler.js가 키워드 하나의 유튜브/뉴스/네이버 수집을 마친 뒤, 그 결과로
 * 계산된 종합점수(getCompositeTrendScore()의 반환값)를
 * composite_trend_snapshots에 upsert합니다. (keyword, snapshot_date) UNIQUE
 * 제약으로 동작해서 같은 날 재실행해도 새 행이 생기지 않고 갱신됩니다.
 *
 * @param {Object} params
 * @param {string} params.keyword
 * @param {string} params.snapshotDate - YYYY-MM-DD (UTC, 스케줄러 실행 시점의 오늘)
 * @param {{value:number|null, dataQuality:string, weightsUsed:Object}} params.compositeScore
 * @param {Object} params.sources - getCompositeTrendScore()의 sources 필드
 * @returns {Promise<Object|null>} upsert된 행(가능한 경우)
 */
export async function saveCompositeSnapshot({ keyword, snapshotDate, compositeScore, sources }) {
  if (!isSupabaseConfigured()) {
    const error = new Error("Supabase가 설정되지 않았습니다(SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY 필요).");
    error.code = "supabase_not_configured";
    throw error;
  }

  const client = getSupabaseClient();

  const { data, error } = await client
    .from(COMPOSITE_SNAPSHOTS_TABLE)
    .upsert(
      {
        keyword,
        snapshot_date: snapshotDate,
        composite_value: compositeScore?.value ?? null,
        composite_data_quality: compositeScore?.dataQuality ?? null,
        weights_used: compositeScore?.weightsUsed ?? null,
        sources: sources ?? null,
      },
      { onConflict: "keyword,snapshot_date" }
    )
    .select();

  if (error) {
    const sanitized = new Error(`Supabase 저장 실패: ${error.message ?? "unknown_error"}`);
    sanitized.code = "supabase_save_failed";
    throw sanitized;
  }

  return Array.isArray(data) && data.length > 0 ? data[0] : null;
}

function assertSupabaseConfigured() {
  if (!isSupabaseConfigured()) {
    const error = new Error("Supabase가 설정되지 않았습니다(SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY 필요).");
    error.code = "supabase_not_configured";
    throw error;
  }
}

/**
 * youtube_daily_trends에서 keyword의 최근 60일 {date, video_count} 배열을
 * 날짜 오름차순으로 반환합니다. 데이터가 없으면 빈 배열(에러 아님).
 * @param {string} keyword
 * @returns {Promise<Array<{date:string, video_count:number}>>}
 */
export async function getYoutubeTrendHistory(keyword) {
  assertSupabaseConfigured();
  const client = getSupabaseClient();

  const { data, error } = await client
    .from("youtube_daily_trends")
    .select("date:collected_date, video_count")
    .eq("keyword", keyword)
    .gte("collected_date", historyCutoffDate())
    .order("collected_date", { ascending: true });

  if (error) {
    const sanitized = new Error(`Supabase 조회 실패: ${error.message ?? "unknown_error"}`);
    sanitized.code = "supabase_query_failed";
    throw sanitized;
  }

  return data ?? [];
}

/**
 * news_daily_trends에서 keyword의 최근 60일 {date, mention_count} 배열을
 * 날짜 오름차순으로 반환합니다. 데이터가 없으면 빈 배열(에러 아님).
 * @param {string} keyword
 * @returns {Promise<Array<{date:string, mention_count:number}>>}
 */
export async function getNewsTrendHistory(keyword) {
  assertSupabaseConfigured();
  const client = getSupabaseClient();

  const { data, error } = await client
    .from("news_daily_trends")
    .select("date:collected_date, mention_count")
    .eq("keyword", keyword)
    .gte("collected_date", historyCutoffDate())
    .order("collected_date", { ascending: true });

  if (error) {
    const sanitized = new Error(`Supabase 조회 실패: ${error.message ?? "unknown_error"}`);
    sanitized.code = "supabase_query_failed";
    throw sanitized;
  }

  return data ?? [];
}

/**
 * naver_trend_cache에서 keyword의 최근 60일 {cache_date, trend_score} 배열을
 * 날짜 오름차순으로 반환합니다. 데이터가 없으면 빈 배열(에러 아님).
 * @param {string} keyword
 * @returns {Promise<Array<{cache_date:string, trend_score:Object}>>}
 */
export async function getNaverTrendHistory(keyword) {
  assertSupabaseConfigured();
  const client = getSupabaseClient();

  const { data, error } = await client
    .from("naver_trend_cache")
    .select("cache_date, trend_score")
    .eq("keyword", keyword)
    .gte("cache_date", historyCutoffDate())
    .order("cache_date", { ascending: true });

  if (error) {
    const sanitized = new Error(`Supabase 조회 실패: ${error.message ?? "unknown_error"}`);
    sanitized.code = "supabase_query_failed";
    throw sanitized;
  }

  return data ?? [];
}

/**
 * composite_trend_snapshots에서 keyword의 최근 60일
 * {snapshot_date, composite_value} 배열을 날짜 오름차순으로 반환합니다.
 * 데이터가 없으면 빈 배열(에러 아님).
 * @param {string} keyword
 * @returns {Promise<Array<{snapshot_date:string, composite_value:number|null}>>}
 */
export async function getCompositeTrendHistory(keyword) {
  assertSupabaseConfigured();
  const client = getSupabaseClient();

  const { data, error } = await client
    .from(COMPOSITE_SNAPSHOTS_TABLE)
    .select("snapshot_date, composite_value")
    .eq("keyword", keyword)
    .gte("snapshot_date", historyCutoffDate())
    .order("snapshot_date", { ascending: true });

  if (error) {
    const sanitized = new Error(`Supabase 조회 실패: ${error.message ?? "unknown_error"}`);
    sanitized.code = "supabase_query_failed";
    throw sanitized;
  }

  return data ?? [];
}
