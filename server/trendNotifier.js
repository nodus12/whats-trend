// 17-3: 실제 트렌드 데이터 -> 17-1 알림 조건 판단 -> 17-2 Web Push 발송 연결
//
// 새로운 알림/발송 로직을 다시 만들지 않고 기존 모듈을 그대로 재사용합니다.
// - 조건 판단/알림 생성: src/utils/notifications.js (17-1)
// - 실제 발송: server/pushSender.js (17-2, sendTestNotificationToAll)
import {
  NotificationType,
  shouldNotifyRisingTrend,
  createNotification,
  deduplicateNotifications,
} from "../src/utils/notifications.js";
import { sendTestNotificationToAll } from "./pushSender.js";
import { isVapidConfigured } from "./webPush.js";
import { getSubscriptionsForType } from "./pushSubscriptions.js";
import { shouldNotifyByFrequency } from "./frequencyPolicy.js";
import {
  hasDedupeKey,
  recordDedupeKeyIfAbsent,
  clearDedupeStore,
} from "./pushDedupeStore.js";

// 같은 트렌드(type + trendId)에 대해 하루 한 번만 푸시를 보내기 위한 기록입니다.
// 18-4: 메모리 Map 대신 SQLite(push_dedupe 테이블, dedupeKey UNIQUE)에 저장해서
// 서버 재시작 후에도 유지됩니다. dedupe key 형식과 "하루 1회" 정책은 그대로입니다.

function todayString() {
  return new Date().toISOString().split("T")[0];
}

// 17-1의 dedupe 키 방식(type:trendId:date)과 동일한 형식을 사용합니다.
function buildDedupeKey(type, trendId) {
  return `${type}:${trendId}:${todayString()}`;
}

function resolveTrendId(trend) {
  if (trend.id) return trend.id;
  if (trend.trendId) return trend.trendId;
  if (trend.keyword) return `trend-${trend.keyword}`;
  return null;
}

// public/sw.js의 push 이벤트가 기대하는 payload 구조를 그대로 사용합니다.
function buildPushPayload(notification) {
  return {
    title: `🔥 ${notification.title}`,
    message: notification.message,
    trendId: notification.trendId,
    type: notification.type,
    keyword: notification.keyword,
    icon: "🔥",
  };
}

/**
 * 실제 트렌드 배열을 검사하여 RISING_TREND 조건을 만족하는 트렌드에 대해
 * 오늘 아직 보내지 않은 경우에만 Web Push를 전송합니다.
 *
 * @param {Array<Object>} trends - 실제 트렌드 데이터 배열 (aggregateTrends 결과 등)
 * @param {Object} [options]
 * @param {boolean} [options.force] - true면 하루 1회 dedupe 검사를 건너뛰고
 *   실제 운영 dedupe 기록(SQLite push_dedupe 테이블)도 남기지 않습니다.
 *   개발/검증 목적(POST /api/push/check-trends)에서만 사용해야 하며,
 *   GET /api/trends의 자동 알림 경로에는 절대 전달하지 않습니다.
 * @returns {Promise<Object>} { success, status?, checked, matched, notified, sent, failed, removed }
 */
export async function checkTrendsAndNotify(trends, options = {}) {
  const force = options.force === true;
  if (!Array.isArray(trends) || trends.length === 0) {
    return { success: true, checked: 0, matched: 0, notified: 0, sent: 0, failed: 0, removed: 0 };
  }

  // 1단계: 17-1 조건(shouldNotifyRisingTrend)을 만족하는 트렌드를 먼저 모두 찾습니다.
  // (dedupe 여부와 무관하게 "조건을 만족한 트렌드 수"를 그대로 집계하기 위함)
  const matchedNotifications = [];

  for (const trend of trends) {
    if (!trend || typeof trend !== "object") continue;
    if (!shouldNotifyRisingTrend(trend)) continue;

    const trendId = resolveTrendId(trend);
    if (!trendId) continue;

    const keyword = trend.keyword || trend.title || "";
    const notification = createNotification({
      type: NotificationType.RISING_TREND,
      title: "급상승 트렌드",
      message: `'${keyword}' 트렌드가 빠르게 상승하고 있어요.`,
      trendId,
      keyword,
      category: trend.category || null,
    });

    if (notification) {
      matchedNotifications.push({
        dedupeKey: buildDedupeKey(NotificationType.RISING_TREND, trendId),
        notification,
        // 18-6: frequency 정책 판단에 trend.stage가 필요해서 원본 trend도 함께 보관합니다.
        trend,
      });
    }
  }

  if (matchedNotifications.length === 0) {
    return { success: true, checked: trends.length, matched: 0, notified: 0, sent: 0, failed: 0, removed: 0 };
  }

  // VAPID가 설정되지 않았으면 아무 것도 시도하지 않고(=dedupe 기록도 남기지 않고)
  // 바로 반환합니다. sendTestNotificationToAll() 호출 이후에야 알 수 있었던
  // 기존 방식 대신 여기서 먼저 확인해서, dedupe를 원자적으로 선점(기록)한 뒤
  // 실제로는 보내지 못하는 상황(선점만 하고 미발송)이 생기지 않게 합니다.
  if (!isVapidConfigured) {
    return {
      success: false,
      status: "vapid_not_configured",
      checked: trends.length,
      matched: matchedNotifications.length,
      notified: 0,
      sent: 0,
      failed: 0,
      removed: 0,
    };
  }

  // 2단계: 오늘 이미 보낸 트렌드는 발송 후보에서 제외합니다(빠른 사전 필터).
  // force === true인 경우(개발/검증 전용)만 이 dedupe 검사를 건너뜁니다.
  // 실제 중복 방지 보장은 아래 루프의 recordDedupeKeyIfAbsent()(UNIQUE 제약
  // 기반 원자적 선점)가 담당하므로, 이 필터는 불필요한 발송 시도를 줄이기
  // 위한 최적화일 뿐입니다.
  const candidates = force
    ? matchedNotifications
    : matchedNotifications.filter(({ dedupeKey }) => !hasDedupeKey(dedupeKey));

  if (candidates.length === 0) {
    return {
      success: true,
      checked: trends.length,
      matched: matchedNotifications.length,
      notified: 0,
      sent: 0,
      failed: 0,
      removed: 0,
    };
  }

  // 17-1의 dedupe 함수를 그대로 재사용해 같은 배치 내 중복도 한 번 더 방어합니다.
  const deduped = deduplicateNotifications(candidates.map((c) => c.notification));
  const dedupedTrendIds = new Set(deduped.map((n) => n.trendId));

  let sentTotal = 0;
  let failedTotal = 0;
  let removedTotal = 0;
  let notifiedCount = 0;

  for (const { dedupeKey, notification, trend } of candidates) {
    if (!dedupedTrendIds.has(notification.trendId)) continue;

    // 18-6: 이 알림 타입을 받을 수 있는 구독자(settings.enabled/types) 중에서도
    // 각자의 frequency 정책까지 통과하는 구독자만 실제 발송 대상으로 추립니다.
    // 기존 RISING_TREND 조건(shouldNotifyRisingTrend)이나 trend의 growthRate/
    // stage/nextScore 값은 전혀 건드리지 않고 그대로 읽기만 합니다.
    const typeEligible = getSubscriptionsForType(notification.type);
    const frequencyEligible = typeEligible.filter((subscription) =>
      shouldNotifyByFrequency(trend, subscription.settings?.frequency)
    );

    // 이 타입을 원하는 구독자가 애초에 없는 경우(기존 동작, frequency와 무관)는
    // 그대로 두고, "구독자는 있지만 전원 frequency 조건에 걸려 제외된" 경우에만
    // dedupe 소비를 건너뜁니다. 그래야 나중에 같은 날 트렌드가 더 강해졌을 때도
    // (예: 전원 frequency=low인데 아직 "폭발 직전"이 아닌 경우) 다시 검사할 수 있습니다.
    if (typeEligible.length > 0 && frequencyEligible.length === 0) {
      continue;
    }

    if (!force) {
      // 발송 전에 dedupe key를 먼저 원자적으로 선점합니다(INSERT, UNIQUE 제약).
      // 동시에 다른 실행(자동 감시 + 수동 요청 등)이 같은 트렌드를 처리 중이었다면
      // 이 호출이 false를 반환하므로, 중복 발송 없이 조용히 건너뜁니다.
      // force 테스트는 실제 운영 dedupe 상태를 오염시키지 않도록 기록을 남기지 않습니다.
      const claimed = recordDedupeKeyIfAbsent(
        dedupeKey,
        notification.type,
        notification.trendId,
        todayString()
      );
      if (!claimed) continue;
    }

    const payload = buildPushPayload(notification);
    const result = await sendTestNotificationToAll(payload, { subscriptions: frequencyEligible });

    notifiedCount += 1;
    sentTotal += result.sent || 0;
    failedTotal += result.failed || 0;
    removedTotal += result.removed || 0;
  }

  return {
    success: true,
    checked: trends.length,
    matched: matchedNotifications.length,
    notified: notifiedCount,
    sent: sentTotal,
    failed: failedTotal,
    removed: removedTotal,
  };
}

/**
 * 테스트 전용: 발송 이력을 초기화합니다.
 */
export function resetTrendPushLog() {
  clearDedupeStore();
}
