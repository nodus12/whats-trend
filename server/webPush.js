import webPush from "web-push";

const PLACEHOLDER_VAPID_SUBJECT = "mailto:REPLACE_WITH_YOUR_EMAIL";

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || null;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || null;
const vapidSubject = process.env.VAPID_SUBJECT || null;

const hasRealSubject = Boolean(vapidSubject) && vapidSubject !== PLACEHOLDER_VAPID_SUBJECT;

export const isVapidConfigured = Boolean(vapidPublicKey && vapidPrivateKey && hasRealSubject);

if (isVapidConfigured) {
  webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
}

export function getVapidPublicKey() {
  return vapidPublicKey;
}

export default webPush;
