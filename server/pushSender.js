import webPush, { isVapidConfigured } from "./webPush.js";
import { getSubscriptionsForType, removeSubscription } from "./pushSubscriptions.js";

const DEFAULT_PAYLOAD = {
  title: "왓츠트렌드",
  message: "새로운 트렌드 알림이 있어요.",
  trendId: null,
  type: null,
  keyword: null,
  icon: "/icons.svg",
};

/**
 * 요청 body를 sw.js의 push 이벤트가 기대하는 payload 구조로 정리합니다.
 * 값이 없거나 형식이 올바르지 않으면 안전한 기본값을 사용합니다.
 * @param {Object} input
 * @returns {Object}
 */
function buildPayload(input) {
  const source = input && typeof input === "object" ? input : {};

  return {
    title:
      typeof source.title === "string" && source.title.trim().length > 0
        ? source.title
        : DEFAULT_PAYLOAD.title,
    message:
      typeof source.message === "string" && source.message.trim().length > 0
        ? source.message
        : DEFAULT_PAYLOAD.message,
    trendId: typeof source.trendId === "string" ? source.trendId : DEFAULT_PAYLOAD.trendId,
    type: typeof source.type === "string" ? source.type : DEFAULT_PAYLOAD.type,
    keyword: typeof source.keyword === "string" ? source.keyword : DEFAULT_PAYLOAD.keyword,
    icon:
      typeof source.icon === "string" && source.icon.trim().length > 0
        ? source.icon
        : DEFAULT_PAYLOAD.icon,
  };
}

/**
 * 저장된 Push Subscription에 알림을 전송합니다.
 * VAPID 설정이 완료되지 않은 경우 전송을 시도하지 않고 명확한 상태를 반환합니다.
 * 전송 중 404/410 오류가 발생한 Subscription은 만료된 것으로 보고 자동 삭제합니다.
 *
 * 18-3: payload.type이 RISING_TREND 등 알림 타입이면, 각 subscription에 저장된
 * 사용자 설정(settings.enabled, settings.types[type])을 확인해서 그 알림을
 * 원하는 사용자에게만 보냅니다. type이 없으면(예: 단순 테스트 payload) 기존과
 * 동일하게 전체 subscription에 보냅니다(하위 호환 - 기존 호출부/테스트 영향 없음).
 *
 * 18-6: options.subscriptions를 전달하면 그 목록에만 발송합니다(trendNotifier.js가
 * frequency 정책까지 통과한 구독자 목록을 미리 계산해서 넘길 때 사용). 이 옵션을
 * 생략하면 기존과 동일하게 이 함수 내부에서 getSubscriptionsForType()으로
 * 타입 기준 전체 대상을 계산합니다 - 기존 호출부(/api/push/send-test 등)는
 * 이 옵션을 모르므로 동작이 전혀 바뀌지 않습니다.
 *
 * @param {Object} input - 알림 payload (title, message, trendId, type, keyword, icon)
 * @param {Object} [options]
 * @param {Array<Object>} [options.subscriptions] - 이미 계산된 발송 대상 목록(선택)
 * @returns {Promise<Object>} 전송 결과
 */
export async function sendTestNotificationToAll(input, options = {}) {
  if (!isVapidConfigured) {
    return {
      success: false,
      status: "vapid_not_configured",
      sent: 0,
      failed: 0,
      removed: 0,
      total: 0,
    };
  }

  const payload = buildPayload(input);
  const subscriptions = Array.isArray(options.subscriptions)
    ? options.subscriptions
    : getSubscriptionsForType(payload.type);
  const payloadString = JSON.stringify(payload);

  let sent = 0;
  let failed = 0;
  let removed = 0;

  await Promise.all(
    subscriptions.map(async ({ endpoint, keys }) => {
      try {
        await webPush.sendNotification({ endpoint, keys }, payloadString);
        sent += 1;
      } catch (error) {
        failed += 1;

        const statusCode = error && typeof error.statusCode === "number" ? error.statusCode : null;

        if (statusCode === 404 || statusCode === 410) {
          removeSubscription(endpoint);
          removed += 1;
        }

        // private key 등 민감한 값은 절대 로그에 남기지 않고, 상태 코드/메시지만 기록합니다.
        console.error(
          "[Push] 전송 실패:",
          statusCode ?? "unknown_status",
          error && error.message ? error.message : "unknown_error"
        );
      }
    })
  );

  return {
    success: true,
    status: "sent",
    sent,
    failed,
    removed,
    total: subscriptions.length,
  };
}
