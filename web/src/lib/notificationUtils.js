let notificationAudioContext = null;

function getAudioContext() {
  if (notificationAudioContext) return notificationAudioContext;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  notificationAudioContext = new Ctx();
  return notificationAudioContext;
}

export async function unlockNotificationAudio() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return false;
    if (ctx.state === 'suspended') await ctx.resume();
    return ctx.state === 'running';
  } catch {
    return false;
  }
}

export function playAttendanceSound(kind = 'success') {
  if (localStorage.getItem('aadi_attendance_sound') === 'off') return;
  try {
    const ctx = getAudioContext();
    if (!ctx || ctx.state !== 'running') return;
    const notes = kind === 'checkin' ? [740, 988] : kind === 'checkout' ? [988, 740] : [220, 180];
    const duration = kind === 'error' ? 0.16 : 0.13;
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type = kind === 'error' ? 'sawtooth' : 'sine'; osc.frequency.value = freq;
      osc.connect(gain); gain.connect(ctx.destination);
      const start = ctx.currentTime + i * (kind === 'error' ? 0.12 : 0.15);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.start(start); osc.stop(start + duration + 0.02);
    });
  } catch {}
}

export async function playNotificationSound(type = 'notification') {
  if (localStorage.getItem('aadi_notification_sound') === 'off') return false;
  try {
    const ctx = getAudioContext();
    if (!ctx) return false;
    if (ctx.state !== 'running') {
      try { await ctx.resume(); } catch {}
    }
    if (ctx.state !== 'running') return false;

    const score = type === 'score_published';
    const notes = score ? [659, 988, 1319] : [880, 1175];
    const step = score ? 0.10 : 0.11;
    const duration = score ? 0.18 : 0.28;

    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = score ? 'triangle' : 'sine';
      const start = ctx.currentTime + i * step;
      osc.frequency.setValueAtTime(freq, start);
      osc.connect(gain); gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(score ? 0.085 : 0.10, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.start(start);
      osc.stop(start + duration + 0.02);
    });
    return true;
  } catch {
    return false;
  }
}

export async function requestBrowserNotifications() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'default') return Notification.requestPermission();
  return Notification.permission;
}

// Installed apps (Android/iOS) must show notifications through the service worker;
// `new Notification()` is rejected there. Falls back to it only on desktop browsers.
export async function showBrowserNotification(title, message) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  const options = { body: message, icon: '/icon-192.png', badge: '/icon-192.png', tag: 'aadi-' + title, renotify: true, vibrate: [120, 60, 120], data: { url: '/' } };
  try {
    if ('serviceWorker' in navigator) {
      const reg = (await navigator.serviceWorker.getRegistration()) || (await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 1500))]));
      if (reg) { await reg.showNotification(title, options); return true; }
    }
  } catch {}
  try { new Notification(title, options); return true; } catch { return false; }
}
