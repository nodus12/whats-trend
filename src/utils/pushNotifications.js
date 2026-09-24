/**
 * ?볦툩?몃젋??Service Worker ?깅줉 ?좏떥由ы떚
 * 釉뚮씪?곗? Notification 諛?Push API 吏??
 */

import { getNotificationSettings } from './notifications.js';

const SERVICE_WORKER_PATH = '/sw.js';

/**
 * Service Worker媛 吏?먮릺?붿? ?뺤씤?⑸땲??
 * @returns {boolean} 吏???щ?
 */
export function isServiceWorkerSupported() {
  return 'serviceWorker' in navigator;
}

/**
 * Push API媛 吏?먮릺?붿? ?뺤씤?⑸땲??
 * @returns {boolean} 吏???щ?
 */
export function isPushSupported() {
  return isServiceWorkerSupported() && 'PushManager' in window;
}

/**
 * Notification API媛 吏?먮릺?붿? ?뺤씤?⑸땲??
 * @returns {boolean} 吏???щ?
 */
export function isNotificationSupported() {
  return 'Notification' in window;
}

/**
 * ?꾩옱 Notification 沅뚰븳 ?곹깭瑜?諛섑솚?⑸땲??
 * @returns {string} 'granted', 'denied', 'default'
 */
export function getNotificationPermission() {
  if (!isNotificationSupported()) {
    return 'unsupported';
  }
  return Notification.permission;
}

/**
 * Service Worker瑜??깅줉?⑸땲??
 * @returns {Promise<Object>} ?깅줉 寃곌낵 { success, registration, error, status }
 */
export async function registerServiceWorker() {
  if (!isServiceWorkerSupported()) {
    return {
      success: false,
      registration: null,
      error: 'Service Worker not supported',
      status: 'unsupported',
    };
  }

  try {
    // 湲곗〈 ?깅줉 ?뺤씤
    const existingRegistration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_PATH);
    if (existingRegistration) {
      return {
        success: true,
        registration: existingRegistration,
        error: null,
        status: 'already_registered',
      };
    }

    // ?덈줈???깅줉
    const registration = await navigator.serviceWorker.register(SERVICE_WORKER_PATH, {
      scope: '/',
    });

    return {
      success: true,
      registration: registration,
      error: null,
      status: 'registered',
    };
  } catch (error) {
    return {
      success: false,
      registration: null,
      error: error.message || 'Registration failed',
      status: 'failed',
    };
  }
}

/**
 * ?꾩옱 Service Worker ?깅줉 ?뺣낫瑜?媛?몄샃?덈떎.
 * @returns {Promise<ServiceWorkerRegistration|null>}
 */
export async function getServiceWorkerRegistration() {
  if (!isServiceWorkerSupported()) {
    return null;
  }

  try {
    return await navigator.serviceWorker.getRegistration(SERVICE_WORKER_PATH);
  } catch {
    return null;
  }
}

/**
 * Service Worker ?깅줉???댁젣?⑸땲??
 * @returns {Promise<boolean>} ?깃났 ?щ?
 */
export async function unregisterServiceWorker() {
  if (!isServiceWorkerSupported()) {
    return false;
  }

  try {
    const registration = await getServiceWorkerRegistration();
    if (registration) {
      await registration.unregister();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Notification 沅뚰븳???붿껌?⑸땲??
 * @returns {Promise<string>} 沅뚰븳 ?곹깭 ('granted', 'denied', 'default', 'unsupported')
 */
export async function requestNotificationPermission() {
  if (!isNotificationSupported()) {
    return 'unsupported';
  }

  try {
    const permission = await Notification.requestPermission();
    return permission;
  } catch {
    return 'denied';
  }
}

/**
 * Service Worker ?깅줉 ?곹깭瑜??뺤씤?⑸땲??
 * @returns {Promise<Object>} ?곹깭 ?뺣낫
 */
export async function getServiceWorkerStatus() {
  if (!isServiceWorkerSupported()) {
    return {
      supported: false,
      registered: false,
      notificationPermission: 'unsupported',
      pushSupported: false,
    };
  }

  try {
    const registration = await getServiceWorkerRegistration();
    return {
      supported: true,
      registered: !!registration,
      notificationPermission: getNotificationPermission(),
      pushSupported: isPushSupported(),
    };
  } catch {
    return {
      supported: true,
      registered: false,
      notificationPermission: getNotificationPermission(),
      pushSupported: isPushSupported(),
    };
  }
}

/**
 * ?뚮┝???쒖떆?⑸땲??(Service Worker瑜??듯빐).
 * @param {Object} options - ?뚮┝ ?듭뀡
 * @returns {Promise<boolean>} ?깃났 ?щ?
 */
export async function showNotification(options = {}) {
  if (!isServiceWorkerSupported()) {
    return false;
  }

  const registration = await getServiceWorkerRegistration();
  if (!registration) {
    return false;
  }

  try {
    const title = options.title || '왓츠트렌드';
    const notificationOptions = {
      body: options.message || '새로운 트렌드 알림이 있어요.',
      icon: options.icon || '/icons.svg',
      badge: '/icons.svg',
      tag: options.tag || 'whats-trend-notification',
      data: {
        trendId: options.trendId || null,
        type: options.type || null,
        keyword: options.keyword || null,
        timestamp: Date.now(),
      },
    };

    await registration.showNotification(title, notificationOptions);
    return true;
  } catch {
    return false;
  }
}


/**
 * 왓츠트렌드 Push Notification 초기화
 * Service Worker 등록 상태를 확인하고 필요하면 등록합니다.
 *
 * @returns {Promise<Object>} 초기화 결과
 */
export async function initializePushNotifications() {
  try {
    if (!isServiceWorkerSupported()) {
      return {
        success: false,
        status: 'unsupported',
        registration: null,
      };
    }

    const result = await registerServiceWorker();

    return {
      success: result.success,
      status: result.status,
      registration: result.registration || null,
    };
  } catch (error) {
    return {
      success: false,
      status: 'failed',
      registration: null,
      error: error.message || 'Push notification initialization failed',
    };
  }
}

/**
 * 현재 Push Subscription을 조회합니다.
 * Push API를 지원하지 않거나 Service Worker가 등록되지 않은 경우에도
 * 예외를 던지지 않고 상태값으로 반환합니다.
 *
 * @returns {Promise<Object>} { success, subscription, error, status }
 */
export async function getPushSubscription() {
  if (!isPushSupported()) {
    return {
      success: false,
      subscription: null,
      error: 'Push API not supported',
      status: 'unsupported',
    };
  }

  try {
    const registration = await getServiceWorkerRegistration();
    if (!registration) {
      return {
        success: false,
        subscription: null,
        error: 'Service Worker not registered',
        status: 'not_registered',
      };
    }

    const subscription = await registration.pushManager.getSubscription();

    return {
      success: true,
      subscription: subscription || null,
      error: null,
      status: subscription ? 'subscribed' : 'not_subscribed',
    };
  } catch (error) {
    return {
      success: false,
      subscription: null,
      error: error.message || 'Failed to get push subscription',
      status: 'failed',
    };
  }
}

/**
 * VAPID public key(base64url 문자열)를 PushManager.subscribe()에 필요한
 * Uint8Array 형태로 변환합니다.
 * @param {string} base64String
 * @returns {Uint8Array}
 */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

/**
 * Push Subscription을 생성합니다.
 * VAPID public key가 없으면 임의의 값으로 대체하지 않고
 * 'vapid_key_missing' 상태를 명시적으로 반환합니다.
 *
 * @param {string} vapidPublicKey - 서버에서 발급한 VAPID public key (base64url)
 * @returns {Promise<Object>} { success, subscription, error, status }
 */
export async function subscribeToPush(vapidPublicKey) {
  if (!isPushSupported()) {
    return {
      success: false,
      subscription: null,
      error: 'Push API not supported',
      status: 'unsupported',
    };
  }

  if (getNotificationPermission() !== 'granted') {
    return {
      success: false,
      subscription: null,
      error: 'Notification permission not granted',
      status: 'permission_denied',
    };
  }

  if (!vapidPublicKey) {
    return {
      success: false,
      subscription: null,
      error: 'VAPID public key is required',
      status: 'vapid_key_missing',
    };
  }

  // 진단 목적으로만 registration을 try 바깥 스코프에 선언합니다.
  // (catch 블록에서도 registration.scope 등을 참조하기 위함이며, 그 외 로직은 변경하지 않습니다.)
  let registration = null;

  try {
    registration = await getServiceWorkerRegistration();
    if (!registration) {
      return {
        success: false,
        subscription: null,
        error: 'Service Worker not registered',
        status: 'not_registered',
      };
    }

    if (import.meta.env.DEV) {
      console.error('[Push 진단] subscribeToPush 시작', {
        origin: location.origin,
        notificationPermission: Notification.permission,
        hasRegistration: Boolean(registration),
        hasActiveWorker: Boolean(registration.active),
        scope: registration.scope,
        pushManagerSupported: 'PushManager' in window,
      });
    }

    const existingSubscription = await registration.pushManager.getSubscription();

    if (import.meta.env.DEV) {
      console.error('[Push 진단] 기존 구독 조회 결과', {
        hasExistingSubscription: Boolean(existingSubscription),
      });
    }

    if (existingSubscription) {
      return {
        success: true,
        subscription: existingSubscription,
        error: null,
        status: 'already_subscribed',
      };
    }

    const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);

    if (import.meta.env.DEV) {
      console.error('[Push 진단] subscribe() 호출 직전', {
        applicationServerKeyIsUint8Array: applicationServerKey instanceof Uint8Array,
        applicationServerKeyByteLength: applicationServerKey.byteLength,
        userVisibleOnly: true,
      });
    }

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });

    return {
      success: true,
      subscription,
      error: null,
      status: 'subscribed',
    };
  } catch (error) {
    if (import.meta.env.DEV) {
      let subscriptionAfterFailure = null;

      try {
        if (registration) {
          subscriptionAfterFailure = await registration.pushManager.getSubscription();
        }
      } catch {
        // 진단용 재조회 실패는 무시합니다.
      }

      console.error('[Push 진단] subscribe() 실패', {
        errorName: error.name,
        errorMessage: error.message,
        errorConstructorName: error.constructor?.name,
        notificationPermissionAfterFailure: Notification.permission,
        hasSubscriptionAfterFailure: Boolean(subscriptionAfterFailure),
        scope: registration ? registration.scope : null,
        origin: location.origin,
      });
    }

    return {
      success: false,
      subscription: null,
      error: error.message || 'Failed to subscribe to push',
      status: 'failed',
    };
  }
}

/**
 * Push Subscription을 해제합니다.
 *
 * @returns {Promise<Object>} { success, error, status }
 */
export async function unsubscribeFromPush() {
  if (!isPushSupported()) {
    return {
      success: false,
      error: 'Push API not supported',
      status: 'unsupported',
    };
  }

  try {
    const registration = await getServiceWorkerRegistration();
    if (!registration) {
      return {
        success: true,
        error: null,
        status: 'not_registered',
      };
    }

    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      return {
        success: true,
        error: null,
        status: 'not_subscribed',
      };
    }

    await subscription.unsubscribe();

    return {
      success: true,
      error: null,
      status: 'unsubscribed',
    };
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Failed to unsubscribe from push',
      status: 'failed',
    };
  }
}

const VAPID_PUBLIC_KEY_ENDPOINT = '/api/push/vapid-public-key';
const PUSH_SUBSCRIBE_ENDPOINT = '/api/push/subscribe';

/**
 * 서버에서 VAPID public key를 조회합니다.
 * private key는 서버에서 절대 내려주지 않으며, 이 함수도 public key만 다룹니다.
 *
 * @returns {Promise<Object>} { success, configured, publicKey, error }
 */
export async function fetchVapidPublicKey() {
  try {
    const response = await fetch(VAPID_PUBLIC_KEY_ENDPOINT);
    const data = await response.json().catch(() => null);

    if (!response.ok || !data) {
      return {
        success: false,
        configured: false,
        publicKey: null,
        error: 'Failed to fetch VAPID public key',
      };
    }

    return {
      success: Boolean(data.success),
      configured: Boolean(data.configured),
      publicKey: data.publicKey || null,
      error: null,
    };
  } catch (error) {
    return {
      success: false,
      configured: false,
      publicKey: null,
      error: error.message || 'Network error while fetching VAPID public key',
    };
  }
}

/**
 * 브라우저 localStorage의 알림 설정(notifications.js 형식)을 서버가 이해하는
 * settings 형식으로 변환합니다. 새로운 의미를 만들지 않고, 기존 필드를
 * 그대로 옮기기만 합니다 (18-3).
 * @param {Object} clientSettings - getNotificationSettings()의 반환값
 * @returns {Object}
 */
function buildServerSettingsPayload(clientSettings) {
  const settings = clientSettings || {};

  return {
    enabled: Boolean(settings.enabled),
    types: {
      RISING_TREND: Boolean(settings.risingTrend),
      NEXT_RISING: Boolean(settings.nextRising),
      PERSONAL_TREND: Boolean(settings.personalTrend),
      SAVED_TREND: Boolean(settings.savedTrend),
      CATEGORY_TREND: Boolean(settings.categoryTrend),
    },
    frequency: typeof settings.frequency === 'string' ? settings.frequency : 'normal',
  };
}

/**
 * 브라우저에서 생성한 Push Subscription을 서버에 등록합니다.
 * settings를 함께 전달하면 서버가 이 구독에 대한 알림 설정도 함께 저장합니다.
 * 같은 endpoint로 다시 호출하면 서버는 새로 추가하지 않고 기존 항목을 갱신합니다.
 *
 * @param {PushSubscription} subscription
 * @param {Object} [serverSettings] - buildServerSettingsPayload()로 만든 형식
 * @returns {Promise<Object>} { success, error }
 */
async function registerSubscriptionOnServer(subscription, serverSettings) {
  try {
    const body = serverSettings
      ? { subscription: subscription.toJSON(), settings: serverSettings }
      : subscription.toJSON();

    const response = await fetch(PUSH_SUBSCRIBE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      return { success: false, error: 'Server rejected the subscription' };
    }

    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: error.message || 'Network error while registering subscription' };
  }
}

/**
 * 서버에 등록된 Push Subscription을 endpoint 기준으로 삭제합니다.
 * @param {string} endpoint
 * @returns {Promise<Object>} { success, error }
 */
async function removeSubscriptionFromServer(endpoint) {
  try {
    const response = await fetch(PUSH_SUBSCRIBE_ENDPOINT, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    });

    if (!response.ok) {
      return { success: false, error: 'Server rejected the unsubscribe request' };
    }

    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: error.message || 'Network error while removing subscription' };
  }
}

/**
 * 푸시 알림 켜기 전체 흐름을 순서대로 실행합니다.
 * VAPID public key 조회 → 알림 권한 확인/요청 → subscribeToPush() → 서버 등록.
 * 기존 subscribeToPush(), requestNotificationPermission() 등을 재사용하며
 * 중복 로직을 새로 만들지 않습니다.
 *
 * @returns {Promise<Object>} { success, status, message, subscription }
 */
export async function enablePushNotifications() {
  const vapidResult = await fetchVapidPublicKey();

  if (import.meta.env.DEV) {
    console.error('[Push 진단] VAPID 공개키 조회 결과', {
      success: vapidResult.success,
      configured: vapidResult.configured,
      hasPublicKey: Boolean(vapidResult.publicKey),
    });
  }

  if (!vapidResult.publicKey) {
    return {
      success: false,
      status: 'vapid_not_configured',
      message: '서버에 VAPID 설정이 아직 완료되지 않았어요.',
      subscription: null,
    };
  }

  let permission = getNotificationPermission();

  if (permission === 'default') {
    permission = await requestNotificationPermission();
  }

  if (import.meta.env.DEV) {
    console.error('[Push 진단] 알림 권한 상태', { permission });
  }

  if (permission !== 'granted') {
    return {
      success: false,
      status: 'permission_denied',
      message: '알림 권한이 허용되지 않았어요. 브라우저 설정에서 알림을 허용해주세요.',
      subscription: null,
    };
  }

  const subscribeResult = await subscribeToPush(vapidResult.publicKey);

  if (import.meta.env.DEV) {
    console.error('[Push 진단] subscribeToPush 결과', {
      success: subscribeResult.success,
      status: subscribeResult.status,
    });
  }

  if (!subscribeResult.success || !subscribeResult.subscription) {
    return {
      success: false,
      status: subscribeResult.status || 'failed',
      message: '푸시 구독을 생성하지 못했어요.',
      subscription: null,
    };
  }

  const serverSettings = buildServerSettingsPayload(getNotificationSettings());
  const serverResult = await registerSubscriptionOnServer(subscribeResult.subscription, serverSettings);

  if (!serverResult.success) {
    return {
      success: false,
      status: 'server_register_failed',
      message: '서버에 구독 정보를 저장하지 못했어요.',
      subscription: subscribeResult.subscription,
    };
  }

  return {
    success: true,
    status: 'enabled',
    message: '푸시 알림이 켜졌어요.',
    subscription: subscribeResult.subscription,
  };
}

/**
 * 푸시 알림 끄기 전체 흐름을 순서대로 실행합니다.
 * 현재 subscription 확인 → 서버에서 삭제 → 브라우저 subscription.unsubscribe().
 * 기존 getPushSubscription(), unsubscribeFromPush()를 재사용합니다.
 *
 * @returns {Promise<Object>} { success, status, message }
 */
export async function disablePushNotifications() {
  const current = await getPushSubscription();

  if (current.subscription) {
    await removeSubscriptionFromServer(current.subscription.endpoint);
  }

  const unsubscribeResult = await unsubscribeFromPush();

  if (!unsubscribeResult.success) {
    return {
      success: false,
      status: unsubscribeResult.status || 'failed',
      message: '푸시 알림을 끄지 못했어요.',
    };
  }

  return {
    success: true,
    status: 'disabled',
    message: '푸시 알림이 꺼졌어요.',
  };
}

/**
 * 현재 브라우저의 알림 설정(notifications.js)을 서버에 등록된 구독 정보에
 * 동기화합니다. Push를 켜지 않은 상태(구독 없음)라면 아무 것도 하지 않습니다.
 * (18-3) 사용자가 알림 설정을 변경할 때마다 호출해서, 서버가 최신 설정을
 * 기준으로 RISING_TREND 등의 Push를 필터링할 수 있게 합니다.
 *
 * @param {Object} clientSettings - getNotificationSettings()의 반환값
 * @returns {Promise<Object>} { success, status }
 */
export async function syncNotificationSettingsToServer(clientSettings) {
  const current = await getPushSubscription();

  if (!current.subscription) {
    return { success: false, status: 'not_subscribed' };
  }

  const serverSettings = buildServerSettingsPayload(clientSettings);
  const result = await registerSubscriptionOnServer(current.subscription, serverSettings);

  if (!result.success) {
    return { success: false, status: 'sync_failed' };
  }

  return { success: true, status: 'synced' };
}
