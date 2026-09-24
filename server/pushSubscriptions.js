// Push Subscription 저장소 (18-4: SQLite 영속 저장)
//
// 18-3까지는 메모리 Map이었으나, 이번 단계에서 SQLite(push_subscriptions +
// notification_type_settings 테이블)로 옮겼습니다. 외부에 노출하는 함수
// 이름/시그니처/반환 구조는 그대로 유지해서 pushSender.js, server.js가
// 전혀 수정될 필요가 없도록 했습니다.
import { getDb } from "./database.js";
import { NotificationType } from "../src/utils/notifications.js";

// src/utils/notifications.js의 NotificationType을 그대로 재사용해서
// 허용 타입 목록이 두 곳에서 따로 관리되지 않게 합니다.
const ALLOWED_TYPES = Object.values(NotificationType);
const ALLOWED_FREQUENCIES = ["low", "normal", "high"];

/**
 * settings가 없는 subscription(하위 호환) 또는 새 subscription에 적용할
 * 기본 설정입니다. src/utils/notifications.js의 getDefaultNotificationData()
 * 기본값(전부 true, frequency:"normal")과 동일한 정책을 따릅니다.
 * @returns {Object}
 */
function getDefaultSettings() {
  const types = {};
  for (const type of ALLOWED_TYPES) {
    types[type] = true;
  }
  return { enabled: true, types, frequency: "normal" };
}

/**
 * 요청으로 들어온 settings 형식이 올바른지 검증합니다.
 * settings 자체가 없는 것(undefined/null)은 "기본값 사용"으로 허용합니다.
 * @param {*} settings
 * @returns {boolean}
 */
export function isValidSettings(settings) {
  if (settings === undefined || settings === null) {
    return true;
  }

  if (typeof settings !== "object" || Array.isArray(settings)) {
    return false;
  }

  if (settings.enabled !== undefined && typeof settings.enabled !== "boolean") {
    return false;
  }

  if (
    settings.frequency !== undefined &&
    !ALLOWED_FREQUENCIES.includes(settings.frequency)
  ) {
    return false;
  }

  if (settings.types !== undefined) {
    if (typeof settings.types !== "object" || settings.types === null || Array.isArray(settings.types)) {
      return false;
    }

    for (const [type, value] of Object.entries(settings.types)) {
      if (!ALLOWED_TYPES.includes(type)) {
        return false;
      }
      if (typeof value !== "boolean") {
        return false;
      }
    }
  }

  return true;
}

/**
 * 검증된 incoming settings를 base(기존 값 또는 기본값) 위에 병합합니다.
 * 부분 업데이트(예: frequency만 보냄)를 지원하기 위해 얕은 병합을 사용합니다.
 * @param {Object|undefined|null} incoming
 * @param {Object} base
 * @returns {Object}
 */
function normalizeSettings(incoming, base) {
  if (!incoming || typeof incoming !== "object") {
    return base;
  }

  const merged = {
    enabled: typeof incoming.enabled === "boolean" ? incoming.enabled : base.enabled,
    types: { ...base.types },
    frequency: typeof incoming.frequency === "string" ? incoming.frequency : base.frequency,
  };

  if (incoming.types && typeof incoming.types === "object") {
    for (const type of ALLOWED_TYPES) {
      if (typeof incoming.types[type] === "boolean") {
        merged.types[type] = incoming.types[type];
      }
    }
  }

  return merged;
}

/**
 * Push Subscription 형태가 올바른지 검증합니다.
 * @param {*} subscription
 * @returns {boolean}
 */
export function isValidSubscription(subscription) {
  if (!subscription || typeof subscription !== "object") {
    return false;
  }

  if (typeof subscription.endpoint !== "string" || subscription.endpoint.trim().length === 0) {
    return false;
  }

  if (!subscription.keys || typeof subscription.keys !== "object") {
    return false;
  }

  const { p256dh, auth } = subscription.keys;

  if (typeof p256dh !== "string" || p256dh.trim().length === 0) {
    return false;
  }

  if (typeof auth !== "string" || auth.trim().length === 0) {
    return false;
  }

  return true;
}

function getSubscriptionRowByEndpoint(db, endpoint) {
  return db.prepare("SELECT * FROM push_subscriptions WHERE endpoint = ?").get(endpoint);
}

function getTypeRows(db, subscriptionId) {
  return db
    .prepare("SELECT type, enabled FROM notification_type_settings WHERE subscription_id = ?")
    .all(subscriptionId);
}

function rowToSubscription(row, typeRows) {
  const types = {};
  for (const type of ALLOWED_TYPES) {
    types[type] = true; // 행이 없는 타입은 기본값(true)으로 취급
  }
  for (const typeRow of typeRows) {
    types[typeRow.type] = Boolean(typeRow.enabled);
  }

  return {
    endpoint: row.endpoint,
    keys: {
      p256dh: row.p256dh,
      auth: row.auth,
    },
    settings: {
      enabled: Boolean(row.enabled),
      types,
      frequency: row.frequency,
    },
  };
}

/**
 * Push Subscription을 저장합니다. endpoint와 keys 외에는 알림 설정(settings)만
 * 함께 저장하며, 그 외의 불필요한 정보는 저장하지 않습니다.
 *
 * 같은 endpoint로 다시 호출하면(재등록/설정 변경) 새 row를 추가하지 않고
 * 기존 row를 갱신합니다(endpoint UNIQUE 제약). settings를 전달하지 않으면:
 *   - 기존에 등록된 endpoint면 그 endpoint의 기존 settings를 그대로 유지
 *   - 새 endpoint면 기본 설정(getDefaultSettings())을 사용
 *
 * @param {Object} subscription
 * @param {Object} [settings] - isValidSettings()로 이미 검증된 값이어야 합니다.
 */
export function saveSubscription(subscription, settings) {
  const db = getDb();
  const now = Date.now();

  const existingRow = getSubscriptionRowByEndpoint(db, subscription.endpoint);
  const base = existingRow
    ? rowToSubscription(existingRow, getTypeRows(db, existingRow.id)).settings
    : getDefaultSettings();

  const merged = normalizeSettings(settings, base);

  let subscriptionId;

  if (existingRow) {
    db.prepare(
      "UPDATE push_subscriptions SET p256dh = ?, auth = ?, enabled = ?, frequency = ?, updated_at = ? WHERE id = ?"
    ).run(
      subscription.keys.p256dh,
      subscription.keys.auth,
      merged.enabled ? 1 : 0,
      merged.frequency,
      now,
      existingRow.id
    );
    subscriptionId = existingRow.id;
  } else {
    const result = db
      .prepare(
        "INSERT INTO push_subscriptions (endpoint, p256dh, auth, enabled, frequency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        subscription.endpoint,
        subscription.keys.p256dh,
        subscription.keys.auth,
        merged.enabled ? 1 : 0,
        merged.frequency,
        now,
        now
      );
    subscriptionId = result.lastInsertRowid;
  }

  const upsertType = db.prepare(
    `INSERT INTO notification_type_settings (subscription_id, type, enabled) VALUES (?, ?, ?)
     ON CONFLICT(subscription_id, type) DO UPDATE SET enabled = excluded.enabled`
  );

  for (const type of ALLOWED_TYPES) {
    upsertType.run(subscriptionId, type, merged.types[type] ? 1 : 0);
  }
}

/**
 * endpoint에 해당하는 Push Subscription을 삭제합니다.
 * notification_type_settings의 관련 행은 FOREIGN KEY ON DELETE CASCADE로 함께 삭제됩니다.
 * @param {string} endpoint
 * @returns {boolean} 실제로 삭제되었는지 여부
 */
export function removeSubscription(endpoint) {
  const db = getDb();
  const result = db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
  return result.changes > 0;
}

/**
 * 현재 저장된 Push Subscription 개수를 반환합니다.
 * @returns {number}
 */
export function getSubscriptionCount() {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) as count FROM push_subscriptions").get();
  return row.count;
}

/**
 * 현재 저장된 모든 Push Subscription을 배열로 반환합니다.
 * @returns {Array<Object>}
 */
export function getAllSubscriptions() {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM push_subscriptions").all();
  return rows.map((row) => rowToSubscription(row, getTypeRows(db, row.id)));
}

/**
 * 주어진 알림 type을 받을 수 있는(설정상 허용된) subscription만 반환합니다.
 * - type이 없으면(null/undefined) 필터링 없이 전체를 반환합니다(하위 호환).
 * - settings.enabled === false 이거나 settings.types[type] === false 이면 제외합니다.
 *
 * @param {string} [type] - NotificationType 값 (예: "RISING_TREND")
 * @returns {Array<Object>}
 */
export function getSubscriptionsForType(type) {
  const all = getAllSubscriptions();

  if (!type) {
    return all;
  }

  return all.filter((subscription) => {
    const settings = subscription.settings;

    if (settings.enabled === false) {
      return false;
    }

    if (settings.types && settings.types[type] === false) {
      return false;
    }

    return true;
  });
}

/**
 * 개발 편의용 상태 확인 함수. endpoint/keys는 절대 포함하지 않고
 * 각 subscription의 settings만 반환합니다(GET /api/push/status에서 사용).
 * @returns {Array<Object>} settings 배열
 */
export function getSubscriptionsSettingsSummary() {
  return getAllSubscriptions().map((subscription) => ({
    settings: subscription.settings,
  }));
}
