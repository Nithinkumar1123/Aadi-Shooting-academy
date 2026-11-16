// Registers the service worker (production only) and exposes a tiny install-prompt store.
let deferred = null;
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());

export function registerPwa() {
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; emit(); });
  window.addEventListener('appinstalled', () => { deferred = null; emit(); });
}
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const canInstall = () => !!deferred;
export async function promptInstall() { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; emit(); }
export function subscribeInstall(fn) { listeners.add(fn); return () => listeners.delete(fn); }
