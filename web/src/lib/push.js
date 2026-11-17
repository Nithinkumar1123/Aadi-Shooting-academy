// Web Push: lets the server notify this phone even when the app is closed / the screen is locked.
import { supabase } from './supabase';

const PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;
const toKey = (b64) => { const p = '='.repeat((4 - (b64.length % 4)) % 4); const raw = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const pushConfigured = () => Boolean(PUBLIC_KEY);

async function getReg() { return (await navigator.serviceWorker.getRegistration()) || (await withTimeout(navigator.serviceWorker.ready, 4000)); }
async function getSub() { const reg = await getReg(); return reg ? reg.pushManager.getSubscription() : null; }

async function save(sub) {
  const j = sub.toJSON();
  const { error } = await supabase.rpc('save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_user_agent: navigator.userAgent });
  if (error) throw error;
}

// 'unsupported' | 'unconfigured' | 'denied' | 'on' | 'off'
export async function pushState() {
  if (!pushSupported()) return 'unsupported';
  if (!pushConfigured()) return 'unconfigured';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'off';
  return (await getSub()) ? 'on' : 'off';
}

export async function enablePush() {
  if (!pushSupported() || !pushConfigured()) return 'unsupported';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return 'denied';
  const reg = await getReg();
  if (!reg) throw new Error('The app is still starting. Please try again in a moment.');
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(PUBLIC_KEY) }));
  await save(sub);
  return 'on';
}

export async function disablePush() {
  const sub = await getSub();
  if (sub) { await supabase.rpc('remove_push_subscription', { p_endpoint: sub.endpoint }); await sub.unsubscribe(); }
  return 'off';
}

// Keep the saved device tied to whoever is signed in (e.g. after logging in as a different user).
export async function resyncPush() { try { const sub = await getSub(); if (sub && Notification.permission === 'granted') await save(sub); } catch {} }
// On sign-out stop this phone receiving the previous user's alerts (re-attached on next sign-in).
export async function detachPush() { try { const sub = await getSub(); if (sub) await supabase.rpc('remove_push_subscription', { p_endpoint: sub.endpoint }); } catch {} }

// Sends a test push to this user's own phones (verifies the whole chain works, incl. a locked screen).
export async function sendTestPush() {
  const { data, error } = await supabase.functions.invoke('push-notify', { body: { test: true } });
  if (error) throw new Error('Could not reach the push service. Has the push-notify function been deployed?');
  if (data?.error) throw new Error(data.error);
  if (!data?.sent) throw new Error('The test was not delivered. Turn alerts off and on again, then retry.');
  return data.sent;
}
