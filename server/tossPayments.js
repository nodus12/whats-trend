// Phase D: 토스페이먼츠 자동결제(빌링) API 클라이언트.
//
// 사전 확인 결과(docs.tosspayments.com 실제 확인 + 설치된
// @tosspayments/tosspayments-sdk v2.8.1의 types/index.d.ts 실측):
// - 빌링키 발급: POST /v1/billing/authorizations/issue { authKey, customerKey }
// - 자동결제 승인: POST /v1/billing/{billingKey} { customerKey, amount, orderId, orderName }
// - 인증: "시크릿 키 뒤에 콜론을 붙이고 base64 인코딩"한 값을 Basic 인증으로 사용.
//   Buffer.from(...)을 쓰는 이유: 문자열을 직접 btoa()류로 인코딩하면 환경에 따라
//   UTF-8 BOM이 섞여 들어가 "77u/"로 시작하는 깨진 값이 나올 수 있다고 문서가
//   명시적으로 경고함 - Buffer는 이 문제가 없음.
//
// server/naverTrendGrowth.js 등 기존 외부 API 모듈과 동일한 원칙으로, 이 파일의
// 함수들은 절대 throw하지 않고 항상 { success, data } 또는
// { success:false, error } 형태로 반환한다 - 호출부(server.js)가 매번 try/catch로
// 감쌀 필요 없이 결과만 보고 분기할 수 있게 하기 위함.
const TOSS_API_BASE = "https://api.tosspayments.com";

export function isTossConfigured() {
  return Boolean(process.env.TOSS_SECRET_KEY);
}

function getAuthHeader() {
  const secretKey = process.env.TOSS_SECRET_KEY;
  return `Basic ${Buffer.from(`${secretKey}:`, "utf-8").toString("base64")}`;
}

async function tossRequest(path, body) {
  if (!isTossConfigured()) {
    return { success: false, error: "toss_not_configured" };
  }

  try {
    const response = await fetch(`${TOSS_API_BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: getAuthHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      return {
        success: false,
        error: data?.code || "toss_request_failed",
        message: data?.message || `토스페이먼츠 API 요청 실패 (status ${response.status})`,
      };
    }

    return { success: true, data };
  } catch (error) {
    return { success: false, error: "toss_network_error", message: error.message };
  }
}

/**
 * authKey(자동결제 등록창에서 successUrl로 돌아온 일회성 인증 키)로
 * 빌링키를 발급받습니다.
 * @param {{authKey: string, customerKey: string}} params
 * @returns {Promise<{success:true, data:{billingKey:string, customerKey:string, mId:string, card:object, [key:string]:any}} | {success:false, error:string, message?:string}>}
 */
export async function issueBillingKey({ authKey, customerKey }) {
  return tossRequest("/v1/billing/authorizations/issue", { authKey, customerKey });
}

/**
 * 발급된 빌링키로 실제 결제(자동결제)를 승인합니다.
 * @param {{billingKey: string, customerKey: string, amount: number, orderId: string, orderName: string, customerEmail?: string}} params
 * @returns {Promise<{success:true, data:object} | {success:false, error:string, message?:string}>}
 */
export async function chargeBillingKey({ billingKey, customerKey, amount, orderId, orderName, customerEmail }) {
  return tossRequest(`/v1/billing/${encodeURIComponent(billingKey)}`, {
    customerKey,
    amount,
    orderId,
    orderName,
    ...(customerEmail ? { customerEmail } : {}),
  });
}
