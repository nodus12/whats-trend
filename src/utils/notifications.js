// 왓츠트렌드 알림 시스템
// 트렌드 데이터 기반 알림 조건 판단 및 관리
// 실제 Web Push는 17-2에서 구현하며, 이 파일은 데이터 구조와 조건 계산을 담당합니다.

const STORAGE_KEY = "whats-trend-notifications";
const MAX_NOTIFICATIONS = 50;

// 알림 타입
export const NotificationType = {
  RISING_TREND: "RISING_TREND",
  NEXT_RISING: "NEXT_RISING",
  PERSONAL_TREND: "PERSONAL_TREND",
  SAVED_TREND: "SAVED_TREND",
  CATEGORY_TREND: "CATEGORY_TREND",
};

// 알림 우선순위
export const NotificationPriority = {
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
};

// 알림 빈도
export const NotificationFrequency = {
  LOW: "low",
  NORMAL: "normal",
  HIGH: "high",
};

/**
 * 기본 알림 데이터 구조를 반환합니다.
 * localStorage에 데이터가 없거나 손상된 경우 사용됩니다.
 * @returns {Object} 기본 알림 데이터
 */
export function getDefaultNotificationData() {
  return {
    version: 1,
    settings: {
      enabled: true,
      risingTrend: true,
      nextRising: true,
      personalTrend: true,
      savedTrend: true,
      categoryTrend: true,
      frequency: "normal",
    },
    notifications: [],
    lastCheckedAt: null,
  };
}

/**
 * 알림 데이터를 안전하게 정규화합니다.
 * 누락된 필드나 잘못된 타입을 기본값으로 복구합니다.
 * @param {Object} data - 정규화할 데이터
 * @returns {Object} 정규화된 데이터
 */
export function normalizeNotificationData(data) {
  const defaults = getDefaultNotificationData();

  if (!data || typeof data !== "object") {
    return defaults;
  }

  return {
    version: typeof data.version === "number" ? data.version : defaults.version,
    settings: {
      enabled: typeof data.settings?.enabled === "boolean" ? data.settings.enabled : defaults.settings.enabled,
      risingTrend: typeof data.settings?.risingTrend === "boolean" ? data.settings.risingTrend : defaults.settings.risingTrend,
      nextRising: typeof data.settings?.nextRising === "boolean" ? data.settings.nextRising : defaults.settings.nextRising,
      personalTrend: typeof data.settings?.personalTrend === "boolean" ? data.settings.personalTrend : defaults.settings.personalTrend,
      savedTrend: typeof data.settings?.savedTrend === "boolean" ? data.settings.savedTrend : defaults.settings.savedTrend,
      categoryTrend: typeof data.settings?.categoryTrend === "boolean" ? data.settings.categoryTrend : defaults.settings.categoryTrend,
      frequency: typeof data.settings?.frequency === "string" ? data.settings.frequency : defaults.settings.frequency,
    },
    notifications: Array.isArray(data.notifications)
      ? data.notifications.filter((n) => n && typeof n === "object" && typeof n.id === "string")
      : [],
    lastCheckedAt: typeof data.lastCheckedAt === "string" ? data.lastCheckedAt : null,
  };
}

/**
 * localStorage에서 알림 데이터를 읽어옵니다.
 * 오류가 발생하거나 데이터가 없으면 기본값을 반환합니다.
 * @returns {Object} 알림 데이터
 */
export function getNotificationData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return getDefaultNotificationData();
    }

    const parsed = JSON.parse(raw);
    return normalizeNotificationData(parsed);
  } catch {
    return getDefaultNotificationData();
  }
}

/**
 * 알림 데이터를 localStorage에 저장합니다.
 * 알림 개수가 MAX_NOTIFICATIONS를 초과하면 오래된 것부터 제거합니다.
 * @param {Object} data - 저장할 알림 데이터
 * @returns {boolean} 저장 성공 여부
 */
export function saveNotificationData(data) {
  try {
    const normalized = normalizeNotificationData(data);

    // 알림 개수 제한
    if (normalized.notifications.length > MAX_NOTIFICATIONS) {
      normalized.notifications = normalized.notifications
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, MAX_NOTIFICATIONS);
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return true;
  } catch {
    return false;
  }
}

/**
 * 알림 설정을 가져옵니다.
 * @returns {Object} 알림 설정
 */
export function getNotificationSettings() {
  try {
    const data = getNotificationData();
    return data.settings;
  } catch {
    return getDefaultNotificationData().settings;
  }
}

/**
 * 알림 설정을 저장합니다.
 * @param {Object} settings - 저장할 설정
 * @returns {boolean} 저장 성공 여부
 */
export function saveNotificationSettings(settings) {
  try {
    const data = getNotificationData();
    data.settings = {
      ...data.settings,
      ...settings,
    };
    return saveNotificationData(data);
  } catch {
    return false;
  }
}

// ============================================================
// 알림 조건 계산
// ============================================================

function isSafeNumber(value) {
  if (typeof value !== "number") return false;
  if (!Number.isFinite(value)) return false;
  if (Number.isNaN(value)) return false;
  return true;
}

function toDateString(dateString) {
  try {
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) {
      return new Date().toISOString().split("T")[0];
    }
    return date.toISOString().split("T")[0];
  } catch {
    return new Date().toISOString().split("T")[0];
  }
}

export function shouldNotifyRisingTrend(trend) {
  try {
    if (!trend || typeof trend !== "object") return false;
    const growthAvailable = trend.growthAvailable === true;
    const growthRate = isSafeNumber(trend.growthRate) ? trend.growthRate : 0;
    const stage = trend.stage;
    const isActiveStage = stage === "상승 중" || stage === "폭발 직전" || stage === "📈" || stage === "🔥" || stage === "rising" || stage === "explosive";
    return growthAvailable && growthRate > 50 && isActiveStage;
  } catch {
    return false;
  }
}

export function shouldNotifyNextRising(trend) {
  try {
    if (!trend || typeof trend !== "object") return false;
    const nextAvailable = trend.nextAvailable === true;
    const nextScore = isSafeNumber(trend.nextScore) ? trend.nextScore : 0;
    return nextAvailable && nextScore >= 75;
  } catch {
    return false;
  }
}

export function shouldNotifyPersonalTrend(trend, personalizationData) {
  try {
    if (!trend || typeof trend !== "object") return false;
    const data = personalizationData || { interests: { categories: [], keywords: [] } };
    const categories = data?.interests?.categories || [];
    const keywords = data?.interests?.keywords || [];
    const trendCategory = (trend.category || "").toLowerCase();
    const trendKeyword = (trend.keyword || trend.title || "").toLowerCase();

    if (Array.isArray(categories) && categories.length > 0) {
      const categoryMatch = categories.some((cat) => {
        const catLower = cat.toLowerCase();
        return trendCategory.includes(catLower) || catLower.includes(trendCategory);
      });
      if (categoryMatch) return true;
    }

    if (Array.isArray(keywords) && keywords.length > 0) {
      const keywordMatch = keywords.some((kw) => {
        const kwLower = kw.toLowerCase();
        return trendKeyword.includes(kwLower) || kwLower.includes(trendKeyword);
      });
      if (keywordMatch) return true;
    }

    return false;
  } catch {
    return false;
  }
}

export function shouldNotifySavedTrend(trend, personalizationData) {
  try {
    if (!trend || typeof trend !== "object") return false;
    const savedTrends = personalizationData?.behavior?.savedTrends;
    if (!Array.isArray(savedTrends) || savedTrends.length === 0) return false;
    const growthAvailable = trend.growthAvailable === true;
    const growthRate = isSafeNumber(trend.growthRate) ? trend.growthRate : 0;
    if (!growthAvailable || growthRate <= 0) return false;
    const trendKeyword = (trend.keyword || trend.title || "").toLowerCase();
    return savedTrends.some((saved) => {
      if (!saved || typeof saved !== "object") return false;
      const savedKeyword = (saved.keyword || "").toLowerCase();
      if (!savedKeyword) return false;
      return trendKeyword.includes(savedKeyword) || savedKeyword.includes(trendKeyword);
    });
  } catch {
    return false;
  }
}

export function shouldNotifyCategoryTrend(trend, personalizationData) {
  try {
    if (!trend || typeof trend !== "object") return false;
    const categories = personalizationData?.interests?.categories;
    if (!Array.isArray(categories) || categories.length === 0) return false;
    const trendCategory = (trend.category || "").toLowerCase();
    return categories.some((cat) => {
      const catLower = cat.toLowerCase();
      return trendCategory.includes(catLower) || catLower.includes(trendCategory);
    });
  } catch {
    return false;
  }
}

function createDeduplicationKey(type, trendId, createdAt) {
  const dateStr = toDateString(createdAt);
  return `${type}:${trendId || "unknown"}:${dateStr}`;
}

export function deduplicateNotifications(notifications) {
  try {
    if (!Array.isArray(notifications)) return [];

    const seen = new Set();
    const result = [];

    for (const notification of notifications) {
      if (!notification || typeof notification !== "object") continue;

      const key = createDeduplicationKey(
        notification.type,
        notification.trendId,
        notification.createdAt
      );

      if (!seen.has(key)) {
        seen.add(key);
        result.push(notification);
      }
    }

    return result;
  } catch {
    return [];
  }
}

export function createNotification({ type, title, message, trendId, keyword, category, priority }) {
  try {
    if (!type || !title || !message) return null;

    return {
      id: `notif-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      title,
      message,
      trendId: trendId || null,
      keyword: keyword || null,
      category: category || null,
      createdAt: new Date().toISOString(),
      read: false,
      priority: priority || NotificationPriority.MEDIUM,
    };
  } catch {
    return null;
  }
}

export function generateNotifications(trends, personalizationData, notificationSettings) {
  try {
    if (!Array.isArray(trends) || trends.length === 0) return [];
    if (!notificationSettings || !notificationSettings.enabled) return [];

    const notifications = [];

    for (const trend of trends) {
      if (!trend || typeof trend !== "object") continue;

      const hiddenTrends = personalizationData?.behavior?.hiddenTrends || [];
      const trendId = trend.id || trend.trendId || trend.keyword || trend.title;
      const isHidden = hiddenTrends.some((h) => h && h.id === trendId);
      if (isHidden) continue;

      const keyword = trend.keyword || trend.title || "";
      const category = trend.category || "";
      const trendIdForNotif = trend.id || `trend-${keyword}`;

      if (notificationSettings.risingTrend && shouldNotifyRisingTrend(trend)) {
        const notification = createNotification({
          type: NotificationType.RISING_TREND,
          title: "급상승 트렌드",
          message: `${keyword} 관련 트렌드가 빠르게 상승하고 있어요.`,
          trendId: trendIdForNotif,
          keyword,
          category,
          priority: NotificationPriority.MEDIUM,
        });
        if (notification) notifications.push(notification);
      }

      if (notificationSettings.nextRising && shouldNotifyNextRising(trend)) {
        const notification = createNotification({
          type: NotificationType.NEXT_RISING,
          title: "NEXT 상승",
          message: `${keyword} 트렌드가 다음 유행으로 떠오를 가능성이 높아요.`,
          trendId: trendIdForNotif,
          keyword,
          category,
          priority: NotificationPriority.HIGH,
        });
        if (notification) notifications.push(notification);
      }

      if (notificationSettings.personalTrend && shouldNotifyPersonalTrend(trend, personalizationData)) {
        const notification = createNotification({
          type: NotificationType.PERSONAL_TREND,
          title: "개인화 트렌드",
          message: `${keyword} 관련 새로운 트렌드가 있어요.`,
          trendId: trendIdForNotif,
          keyword,
          category,
          priority: NotificationPriority.MEDIUM,
        });
        if (notification) notifications.push(notification);
      }

      if (notificationSettings.savedTrend && shouldNotifySavedTrend(trend, personalizationData)) {
        const notification = createNotification({
          type: NotificationType.SAVED_TREND,
          title: "저장 트렌드 변화",
          message: `${keyword} 트렌드가 다시 상승하고 있어요.`,
          trendId: trendIdForNotif,
          keyword,
          category,
          priority: NotificationPriority.HIGH,
        });
        if (notification) notifications.push(notification);
      }

      if (notificationSettings.categoryTrend && shouldNotifyCategoryTrend(trend, personalizationData)) {
        const notification = createNotification({
          type: NotificationType.CATEGORY_TREND,
          title: "관심 카테고리",
          message: `${category}에서 새로운 트렌드가 발견됐어요.`,
          trendId: trendIdForNotif,
          keyword,
          category,
          priority: NotificationPriority.LOW,
        });
        if (notification) notifications.push(notification);
      }
    }

    return deduplicateNotifications(notifications);
  } catch {
    return [];
  }
}

// ============================================================
// 알림 읽음 처리
// ============================================================

export function getNotifications() {
  try {
    const data = getNotificationData();
    return data.notifications || [];
  } catch {
    return [];
  }
}

export function getUnreadNotificationCount() {
  try {
    const notifications = getNotifications();
    return notifications.filter((n) => n && !n.read).length;
  } catch {
    return 0;
  }
}

export function markNotificationAsRead(notificationId) {
  try {
    if (typeof notificationId !== "string") return false;

    const data = getNotificationData();
    const notification = data.notifications.find((n) => n.id === notificationId);

    if (notification) {
      notification.read = true;
      return saveNotificationData(data);
    }

    return false;
  } catch {
    return false;
  }
}

export function markAllNotificationsAsRead() {
  try {
    const data = getNotificationData();

    data.notifications.forEach((n) => {
      if (n && typeof n === "object") {
        n.read = true;
      }
    });

    return saveNotificationData(data);
  } catch {
    return false;
  }
}

export function addNotifications(newNotifications) {
  try {
    if (!Array.isArray(newNotifications) || newNotifications.length === 0) return false;

    const data = getNotificationData();

    for (const notification of newNotifications) {
      if (notification && typeof notification === "object") {
        data.notifications.unshift(notification);
      }
    }

    data.lastCheckedAt = new Date().toISOString();

    return saveNotificationData(data);
  } catch {
    return false;
  }
}

export function clearAllNotifications() {
  try {
    const data = getNotificationData();
    data.notifications = [];
    return saveNotificationData(data);
  } catch {
    return false;
  }
}