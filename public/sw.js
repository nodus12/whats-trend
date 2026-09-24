/**
 * 왓츠트렌드 Service Worker
 * Web Push 알림 처리
 */

// install event - Service Worker 설치
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

// activate event - Service Worker 활성화
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// push event - 푸시 메시지 수신
self.addEventListener('push', (event) => {
  try {
    let notificationData = {
      title: '왓츠트렌드',
      message: '새로운 트렌드 알림이 있어요.',
      trendId: null,
      type: null,
      keyword: null,
    };

    if (event.data) {
      try {
        const data = event.data.json();
        notificationData = {
          title: data.title || notificationData.title,
          message: data.message || notificationData.message,
          trendId: data.trendId || null,
          type: data.type || null,
          keyword: data.keyword || null,
          icon: data.icon || '/icons.svg',
        };
      } catch {
        notificationData.message = event.data.text() || notificationData.message;
      }
    }

    const options = {
      body: notificationData.message,
      icon: notificationData.icon || '/icons.svg',
      badge: '/icons.svg',
      tag: notificationData.type || 'whats-trend-notification',
      requireInteraction: false,
      silent: false,
      data: {
        trendId: notificationData.trendId,
        type: notificationData.type,
        keyword: notificationData.keyword,
        timestamp: Date.now(),
      },
    };

    event.waitUntil(
      self.registration.showNotification(notificationData.title, options)
    );
  } catch (error) {
    console.error('Push notification error:', error);
  }
});

// notificationclick event - 알림 클릭 처리
self.addEventListener('notificationclick', (event) => {
  try {
    event.notification.close();

    const notificationData = event.notification.data || {};
    const trendId = notificationData.trendId || null;
    const keyword = notificationData.keyword || null;

    // URL 구성 - 트렌드 ID가 있으면 포함, 없으면 홈으로
    let targetUrl = self.location.origin;
    if (trendId) {
      targetUrl += '/?trend=' + encodeURIComponent(trendId);
    } else if (keyword) {
      targetUrl += '/?keyword=' + encodeURIComponent(keyword);
    }

    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        // 기존 창이 있으면 포커스
        for (const client of clientList) {
          if (client.url.startsWith(self.location.origin) && 'focus' in client) {
            client.focus();
            // 트렌드 ID가 있으면 클라이언트에 메시지 전송
            if (trendId) {
              client.postMessage({
                type: 'NOTIFICATION_CLICK',
                trendId: trendId,
                keyword: keyword,
                notificationType: notificationData.type,
              });
            }
            return;
          }
        }
        // 기존 창이 없으면 새 창 열기
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
    );
  } catch (error) {
    console.error('Notification click error:', error);
  }
});

// notificationclose event - 알림 닫기 처리
self.addEventListener('notificationclose', () => {
  // 필요시 분석 로직 추가 가능
});

// 메시지 수신 (클라이언트에서 온 메시지)
self.addEventListener('message', (event) => {
  try {
    const { type } = event.data || {};

    switch (type) {
      case 'SKIP_WAITING':
        self.skipWaiting();
        break;
      default:
        break;
    }
  } catch (error) {
    console.error('Service Worker message error:', error);
  }
});
