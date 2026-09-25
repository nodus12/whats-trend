// 3-4단계: 자동 수집 스케줄러가 감시할 키워드 목록 저장소(tracked_keywords)
//
// server/scheduler.js가 "무엇을 수집할지" 알기 위한 최소한의 CRUD만
// 제공합니다. 이 파일 자체는 수집/저장(youtube/news/naver) 로직을 전혀
// 모르고, 오직 키워드 목록 관리만 책임집니다 - youtubeDailyTrend.js가
// "언제 저장할지"만 알고 youtubeTrend.js의 계산 로직을 모르는 것과 같은
// 분리 원칙입니다.
//
// Phase C: tracked_keywords에 user_id(소유자)가 추가되어, 이제 대부분의
// 함수가 userId를 받아 "본인 row만" 대상으로 동작합니다. 예외는
// listActiveTrackedKeywords()뿐입니다 - 이건 server/scheduler.js 전용이고,
// 스케줄러는 특정 사용자가 아니라 "지금 활성 상태인 모든 keyword 문자열"을
// 수집해야 하므로 사용자 구분 없이 조회하되, 여러 사용자가 같은 키워드를
// 등록해도 한 번만 수집하도록 keyword 기준으로 중복 제거해서 반환합니다.
import { getSupabaseClient, isSupabaseConfigured } from "./supabase.js";

export const TRACKED_KEYWORDS_TABLE = "tracked_keywords";

function assertSupabaseConfigured() {
  if (!isSupabaseConfigured()) {
    const error = new Error("Supabase가 설정되지 않았습니다(SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY 필요).");
    error.code = "supabase_not_configured";
    throw error;
  }
}

/**
 * 특정 사용자의 전체 키워드 목록을 반환합니다(is_active와 무관,
 * GET /api/keywords용).
 * @param {string} userId
 * @returns {Promise<Array<{id:number, keyword:string, is_active:boolean, created_at:string}>>}
 */
export async function listTrackedKeywords(userId) {
  assertSupabaseConfigured();
  const client = getSupabaseClient();

  const { data, error } = await client
    .from(TRACKED_KEYWORDS_TABLE)
    .select("id, keyword, is_active, created_at")
    .eq("user_id", userId)
    .order("id", { ascending: true });

  if (error) {
    const sanitized = new Error(`Supabase 조회 실패: ${error.message ?? "unknown_error"}`);
    sanitized.code = "supabase_query_failed";
    throw sanitized;
  }

  return data ?? [];
}

/**
 * 특정 사용자의 현재 활성 키워드 개수를 셉니다(POST /api/keywords의 무료
 * 플랜 3개 제한 판정용).
 * @param {string} userId
 * @returns {Promise<number>}
 */
export async function countActiveTrackedKeywords(userId) {
  assertSupabaseConfigured();
  const client = getSupabaseClient();

  const { count, error } = await client
    .from(TRACKED_KEYWORDS_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_active", true);

  if (error) {
    const sanitized = new Error(`Supabase 조회 실패: ${error.message ?? "unknown_error"}`);
    sanitized.code = "supabase_query_failed";
    throw sanitized;
  }

  return count ?? 0;
}

/**
 * is_active=true인 keyword를 사용자 구분 없이 중복 제거해서 반환합니다
 * (server/scheduler.js 전용 - 여러 사용자가 같은 키워드를 등록해도
 * 한 번만 수집하기 위함).
 * @returns {Promise<Array<{keyword:string}>>}
 */
export async function listActiveTrackedKeywords() {
  assertSupabaseConfigured();
  const client = getSupabaseClient();

  const { data, error } = await client
    .from(TRACKED_KEYWORDS_TABLE)
    .select("keyword")
    .eq("is_active", true)
    .order("id", { ascending: true });

  if (error) {
    const sanitized = new Error(`Supabase 조회 실패: ${error.message ?? "unknown_error"}`);
    sanitized.code = "supabase_query_failed";
    throw sanitized;
  }

  const uniqueKeywords = [...new Set((data ?? []).map((row) => row.keyword))];
  return uniqueKeywords.map((keyword) => ({ keyword }));
}

/**
 * 특정 사용자 소유로 키워드를 새로 등록합니다. UNIQUE(user_id, keyword)
 * 위반(Postgres 23505)이면 throw하되 code를 "keyword_already_exists"로
 * 구분해서, 호출부(route)가 409로 응답할 수 있게 합니다.
 * @param {string} userId
 * @param {string} keyword
 * @returns {Promise<{id:number, keyword:string, is_active:boolean, created_at:string, user_id:string}>}
 */
export async function addTrackedKeyword(userId, keyword) {
  if (typeof keyword !== "string" || !keyword.trim()) {
    const error = new Error("keyword가 필요합니다.");
    error.code = "tracked_keyword_invalid";
    throw error;
  }

  assertSupabaseConfigured();
  const client = getSupabaseClient();

  const { data, error } = await client
    .from(TRACKED_KEYWORDS_TABLE)
    .insert({ keyword: keyword.trim(), user_id: userId })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      const sanitized = new Error(`이미 등록된 키워드입니다: ${keyword.trim()}`);
      sanitized.code = "keyword_already_exists";
      throw sanitized;
    }
    const sanitized = new Error(`Supabase 저장 실패: ${error.message ?? "unknown_error"}`);
    sanitized.code = "supabase_save_failed";
    throw sanitized;
  }

  return data;
}

/**
 * userId 소유의 id에 해당하는 키워드를 is_active=false로 바꿉니다(하드
 * 삭제 대신 소프트 삭제 - 기존과 동일한 이유). id가 존재해도 userId
 * 소유가 아니면 조건에 매칭되는 row가 없어 null을 반환합니다 - 이 방식으로
 * "본인 것만" 삭제 가능하다는 것을 별도 소유권 확인 쿼리 없이 보장합니다
 * (Phase B의 /api/pro/activate-mock과 동일하게, 요청에 담긴 타인 id를
 * 신뢰하지 않고 검증된 userId만 사용).
 * @param {string} userId
 * @param {number} id
 * @returns {Promise<{id:number, keyword:string, is_active:boolean}|null>} 갱신된 행(없으면 null)
 */
export async function deactivateTrackedKeyword(userId, id) {
  assertSupabaseConfigured();
  const client = getSupabaseClient();

  const { data, error } = await client
    .from(TRACKED_KEYWORDS_TABLE)
    .update({ is_active: false })
    .eq("id", id)
    .eq("user_id", userId)
    .select();

  if (error) {
    const sanitized = new Error(`Supabase 삭제(비활성화) 실패: ${error.message ?? "unknown_error"}`);
    sanitized.code = "supabase_save_failed";
    throw sanitized;
  }

  return Array.isArray(data) && data.length > 0 ? data[0] : null;
}
