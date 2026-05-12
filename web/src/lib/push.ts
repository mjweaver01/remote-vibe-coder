// Client-side Web Push: register the service worker, subscribe to push,
// and post the subscription to the server. Failures are non-fatal — the
// rest of the app keeps working without notifications.

import { withToken } from "./auth.ts";

export interface PushState {
  supported: boolean;
  /** "default" | "granted" | "denied" — mirrors Notification.permission. */
  permission: NotificationPermission;
  subscribed: boolean;
}

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  return reg;
}

export async function getPushState(): Promise<PushState> {
  if (!isPushSupported()) {
    return { supported: false, permission: "default", subscribed: false };
  }
  const reg = await navigator.serviceWorker.getRegistration("/sw.js").catch(() => null);
  const existing = await reg?.pushManager.getSubscription().catch(() => null);
  return {
    supported: true,
    permission: Notification.permission,
    subscribed: !!existing,
  };
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const buf = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function enablePush(): Promise<void> {
  if (!isPushSupported()) throw new Error("Push not supported in this browser.");
  const permission =
    Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notification permission denied.");

  const keyRes = await fetch(withToken("/api/push/vapid-public-key"));
  if (!keyRes.ok) throw new Error("Server has no VAPID key available.");
  const { publicKey } = (await keyRes.json()) as { publicKey: string };

  const reg = await getRegistration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }
  const res = await fetch(withToken("/api/push/subscribe"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subscription: sub.toJSON(), ua: navigator.userAgent }),
  });
  if (!res.ok) throw new Error("Server rejected push subscription.");
}

export async function disablePush(): Promise<void> {
  if (!isPushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await fetch(withToken("/api/push/unsubscribe"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
}
