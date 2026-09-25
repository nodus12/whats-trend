// Phase D: 자동결제(빌링) 구독 흐름 전용 API 호출 함수 모음.
// src/api/monitoring.js와 동일한 패턴 - 전부 로그인 필수라 세션 토큰을
// Authorization 헤더에 실어 보낸다.

async function getJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => null);

  if (!response.ok || !data || data.success === false) {
    const message = data?.message || "요청을 처리하지 못했어요.";
    const error = new Error(message);
    error.status = response.status;
    error.detail = data?.detail;
    throw error;
  }

  return data;
}

export async function startBilling(plan, token) {
  return getJson("/api/subscription/start-billing", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ plan }),
  });
}

export async function confirmBilling({ authKey, customerKey }, token) {
  return getJson("/api/subscription/confirm-billing", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ authKey, customerKey }),
  });
}

export async function cancelSubscription(token) {
  return getJson("/api/subscription/cancel", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function fetchSubscriptionStatus(token) {
  return getJson("/api/subscription/status", {
    headers: { Authorization: `Bearer ${token}` },
  });
}
