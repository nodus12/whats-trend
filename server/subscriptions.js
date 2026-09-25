// Phase D: subscriptions 테이블 데이터 접근 계층.
//
// server/trackedKeywords.js와 동일한 분리 원칙 - 이 파일은 subscriptions
// row를 읽고 쓰는 것만 책임지고, 실제 토스페이먼츠 API 호출(발급/승인)은
// server/tossPayments.js가, "언제 호출할지" 판단은 server.js의 라우트
// 핸들러가 담당한다.
//
// 사용자당 subscriptions row는 최대 1개로 관리한다(스키마에 UNIQUE 제약은
// 없지만, "PRO 시작하기"를 여러 번 시도해도 새 row가 계속 쌓이지 않도록
// upsertPendingSubscription()이 기존 row가 있으면 갱신, 없으면 생성한다) -
// GET /api/subscription/status가 "이 사용자의 구독 상태"를 단일 값으로
// 응답할 수 있어야 하기 때문이다.
import { getSupabaseClient, isSupabaseConfigured } from "./supabase.js";

export const SUBSCRIPTIONS_TABLE = "subscriptions";

export const PLAN_PRICES = { monthly: 3900, yearly: 27900 };
export const PLAN_ORDER_NAMES = {
  monthly: "왓츠트렌드 PRO 월간 구독",
  yearly: "왓츠트렌드 PRO 연간 구독",
};

function assertSupabaseConfigured() {
  if (!isSupabaseConfigured()) {
    const error = new Error("Supabase가 설정되지 않았습니다(SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY 필요).");
    error.code = "supabase_not_configured";
    throw error;
  }
}

/**
 * plan에 따라 "결제 시점 + 1개월/1년"을 계산합니다.
 * @param {'monthly'|'yearly'} plan
 * @param {Date} [from]
 * @returns {string} ISO timestamp
 */
export function computePeriodEnd(plan, from = new Date()) {
  const next = new Date(from);
  if (plan === "yearly") {
    next.setFullYear(next.getFullYear() + 1);
  } else {
    next.setMonth(next.getMonth() + 1);
  }
  return next.toISOString();
}

/**
 * orderId는 6~64자, 영문 대소문자/숫자/-_=만 허용(토스 규칙) - userId(uuid,
 * 하이픈 포함)와 타임스탬프를 조합해 충분히 유일하게 만든다.
 * @param {string} userId
 * @returns {string}
 */
export function generateOrderId(userId) {
  return `sub_${userId.replace(/-/g, "")}_${Date.now()}`;
}

export async function getSubscriptionByUserId(userId) {
  assertSupabaseConfigured();
  const client = getSupabaseClient();

  const { data, error } = await client
    .from(SUBSCRIPTIONS_TABLE)
    .select("*")
    .eq("user_id", userId)
    .order("id", { ascending: false })
    .limit(1);

  if (error) {
    const sanitized = new Error(`Supabase 조회 실패: ${error.message ?? "unknown_error"}`);
    sanitized.code = "supabase_query_failed";
    throw sanitized;
  }

  return Array.isArray(data) && data.length > 0 ? data[0] : null;
}

/**
 * 카드 등록창을 열기 직전에 호출합니다 - 기존 row가 있으면 pending으로
 * 되돌리고(billing_key는 아직 없으므로 null로), 없으면 새로 만듭니다.
 * @param {{userId: string, customerKey: string, plan: 'monthly'|'yearly'}} params
 */
export async function upsertPendingSubscription({ userId, customerKey, plan }) {
  assertSupabaseConfigured();
  const client = getSupabaseClient();

  const existing = await getSubscriptionByUserId(userId);

  if (existing) {
    const { data, error } = await client
      .from(SUBSCRIPTIONS_TABLE)
      .update({
        customer_key: customerKey,
        plan,
        status: "pending",
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select()
      .single();

    if (error) {
      const sanitized = new Error(`Supabase 저장 실패: ${error.message ?? "unknown_error"}`);
      sanitized.code = "supabase_save_failed";
      throw sanitized;
    }
    return data;
  }

  const { data, error } = await client
    .from(SUBSCRIPTIONS_TABLE)
    .insert({ user_id: userId, customer_key: customerKey, plan, status: "pending" })
    .select()
    .single();

  if (error) {
    const sanitized = new Error(`Supabase 저장 실패: ${error.message ?? "unknown_error"}`);
    sanitized.code = "supabase_save_failed";
    throw sanitized;
  }
  return data;
}

/**
 * 빌링키 발급 + 첫 결제 승인이 모두 성공한 뒤 호출합니다.
 * @param {{userId: string, customerKey: string, billingKey: string, plan: 'monthly'|'yearly'}} params
 */
export async function activateSubscription({ userId, customerKey, billingKey, plan }) {
  assertSupabaseConfigured();
  const client = getSupabaseClient();

  const { data, error } = await client
    .from(SUBSCRIPTIONS_TABLE)
    .update({
      billing_key: billingKey,
      status: "active",
      current_period_end: computePeriodEnd(plan),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("customer_key", customerKey)
    .select()
    .single();

  if (error) {
    const sanitized = new Error(`Supabase 저장 실패: ${error.message ?? "unknown_error"}`);
    sanitized.code = "supabase_save_failed";
    throw sanitized;
  }
  return data;
}

/**
 * 빌링키 발급 또는 첫 결제 승인이 실패했을 때 호출합니다.
 * @param {{userId: string, customerKey: string}} params
 */
export async function markSubscriptionPastDue({ userId, customerKey }) {
  assertSupabaseConfigured();
  const client = getSupabaseClient();

  const { error } = await client
    .from(SUBSCRIPTIONS_TABLE)
    .update({ status: "past_due", updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("customer_key", customerKey);

  if (error) {
    const sanitized = new Error(`Supabase 저장 실패: ${error.message ?? "unknown_error"}`);
    sanitized.code = "supabase_save_failed";
    throw sanitized;
  }
}

/**
 * 구독을 해지합니다. tier는 여기서 건드리지 않습니다(이미 결제된 기간
 * 끝까지는 PRO 유지 - current_period_end까지는 status만 canceled로 바뀌고
 * 갱신 스케줄러가 더 이상 재청구하지 않게 되는 방식).
 * @param {string} userId
 * @returns {Promise<object|null>} 갱신된 행(없으면 null)
 */
export async function cancelSubscriptionByUserId(userId) {
  assertSupabaseConfigured();
  const client = getSupabaseClient();

  const { data, error } = await client
    .from(SUBSCRIPTIONS_TABLE)
    .update({ status: "canceled", updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("status", "active")
    .select();

  if (error) {
    const sanitized = new Error(`Supabase 저장 실패: ${error.message ?? "unknown_error"}`);
    sanitized.code = "supabase_save_failed";
    throw sanitized;
  }
  return Array.isArray(data) && data.length > 0 ? data[0] : null;
}

/**
 * 갱신 스케줄러 전용 - status='active'이면서 current_period_end가 이미
 * 지난(또는 지금인) 구독 전부를 반환합니다.
 * @returns {Promise<Array<object>>}
 */
export async function listSubscriptionsDueForRenewal() {
  assertSupabaseConfigured();
  const client = getSupabaseClient();

  const { data, error } = await client
    .from(SUBSCRIPTIONS_TABLE)
    .select("*")
    .eq("status", "active")
    .lte("current_period_end", new Date().toISOString());

  if (error) {
    const sanitized = new Error(`Supabase 조회 실패: ${error.message ?? "unknown_error"}`);
    sanitized.code = "supabase_query_failed";
    throw sanitized;
  }
  return data ?? [];
}

/**
 * 갱신 결제가 성공했을 때 current_period_end를 다음 주기로 미룹니다.
 * @param {number} id
 * @param {'monthly'|'yearly'} plan
 */
export async function extendSubscriptionPeriod(id, plan) {
  assertSupabaseConfigured();
  const client = getSupabaseClient();

  const { error } = await client
    .from(SUBSCRIPTIONS_TABLE)
    .update({ current_period_end: computePeriodEnd(plan), updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    const sanitized = new Error(`Supabase 저장 실패: ${error.message ?? "unknown_error"}`);
    sanitized.code = "supabase_save_failed";
    throw sanitized;
  }
}

/**
 * 갱신 결제가 실패했을 때 상태만 past_due로 바꿉니다(id 기준 - 갱신
 * 스케줄러가 이미 row를 들고 있으므로 user_id/customer_key 재조회 불필요).
 * @param {number} id
 */
export async function markSubscriptionPastDueById(id) {
  assertSupabaseConfigured();
  const client = getSupabaseClient();

  const { error } = await client
    .from(SUBSCRIPTIONS_TABLE)
    .update({ status: "past_due", updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    const sanitized = new Error(`Supabase 저장 실패: ${error.message ?? "unknown_error"}`);
    sanitized.code = "supabase_save_failed";
    throw sanitized;
  }
}
