// 3-4단계: 자동 수집 스케줄러가 감시할 키워드 목록 저장소(tracked_keywords)
//
// server/scheduler.js가 "무엇을 수집할지" 알기 위한 최소한의 CRUD만
// 제공합니다. 이 파일 자체는 수집/저장(youtube/news/naver) 로직을 전혀
// 모르고, 오직 키워드 목록 관리만 책임집니다 - youtubeDailyTrend.js가
// "언제 저장할지"만 알고 youtubeTrend.js의 계산 로직을 모르는 것과 같은
// 분리 원칙입니다.
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
 * 전체 키워드 목록을 반환합니다(is_active와 무관, GET /api/keywords용).
 * @returns {Promise<Array<{id:number, keyword:string, is_active:boolean, created_at:string}>>}
 */
export async function listTrackedKeywords() {
  assertSupabaseConfigured();
  const client = getSupabaseClient();

  const { data, error } = await client
    .from(TRACKED_KEYWORDS_TABLE)
    .select("id, keyword, is_active, created_at")
    .order("id", { ascending: true });

  if (error) {
    const sanitized = new Error(`Supabase 조회 실패: ${error.message ?? "unknown_error"}`);
    sanitized.code = "supabase_query_failed";
    throw sanitized;
  }

  return data ?? [];
}

/**
 * is_active=true인 키워드만 반환합니다(server/scheduler.js가 이 함수만 사용).
 * @returns {Promise<Array<{id:number, keyword:string}>>}
 */
export async function listActiveTrackedKeywords() {
  assertSupabaseConfigured();
  const client = getSupabaseClient();

  const { data, error } = await client
    .from(TRACKED_KEYWORDS_TABLE)
    .select("id, keyword")
    .eq("is_active", true)
    .order("id", { ascending: true });

  if (error) {
    const sanitized = new Error(`Supabase 조회 실패: ${error.message ?? "unknown_error"}`);
    sanitized.code = "supabase_query_failed";
    throw sanitized;
  }

  return data ?? [];
}

/**
 * 키워드를 새로 등록합니다. keyword UNIQUE 제약 위반(Postgres 23505)이면
 * throw하되 code를 "keyword_already_exists"로 구분해서, 호출부(route)가
 * 409로 응답할 수 있게 합니다.
 * @param {string} keyword
 * @returns {Promise<{id:number, keyword:string, is_active:boolean, created_at:string}>}
 */
export async function addTrackedKeyword(keyword) {
  if (typeof keyword !== "string" || !keyword.trim()) {
    const error = new Error("keyword가 필요합니다.");
    error.code = "tracked_keyword_invalid";
    throw error;
  }

  assertSupabaseConfigured();
  const client = getSupabaseClient();

  const { data, error } = await client
    .from(TRACKED_KEYWORDS_TABLE)
    .insert({ keyword: keyword.trim() })
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
 * id에 해당하는 키워드를 is_active=false로 바꿉니다(하드 삭제 대신
 * 소프트 삭제 - tracked_keywords 테이블에 is_active 컬럼이 이미 이 용도로
 * 설계되어 있으므로 그대로 활용합니다. 되돌리고 싶을 때 행 손실 없이
 * 복구할 수 있다는 장점도 있습니다).
 * @param {number} id
 * @returns {Promise<{id:number, keyword:string, is_active:boolean}|null>} 갱신된 행(없으면 null)
 */
export async function deactivateTrackedKeyword(id) {
  assertSupabaseConfigured();
  const client = getSupabaseClient();

  const { data, error } = await client
    .from(TRACKED_KEYWORDS_TABLE)
    .update({ is_active: false })
    .eq("id", id)
    .select();

  if (error) {
    const sanitized = new Error(`Supabase 삭제(비활성화) 실패: ${error.message ?? "unknown_error"}`);
    sanitized.code = "supabase_save_failed";
    throw sanitized;
  }

  return Array.isArray(data) && data.length > 0 ? data[0] : null;
}
