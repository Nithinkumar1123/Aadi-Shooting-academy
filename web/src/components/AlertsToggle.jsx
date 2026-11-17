import { useEffect, useState } from 'react';
import { BellRing, BellOff, Smartphone } from 'lucide-react';
import { disablePush, enablePush, pushConfigured, pushState, pushSupported, resyncPush } from '../lib/push';
import { isIos, isStandalone } from '../lib/pwa';
import { playNotificationSound, requestBrowserNotifications, unlockNotificationAudio } from '../lib/notificationUtils';

// ONE switch for all alerts: the in-app sound AND phone notifications (which also reach a locked phone).
// variant "top": compact button for the admin top bar.  variant "card": full row for the member home.
const KEY = 'aadi_notification_sound';
const readPref = () => { try { return localStorage.getItem(KEY) === 'on'; } catch { return false; } };
const writePref = (on) => { try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch {} };

export default function AlertsToggle({ variant = 'top' }) {
  const [on, setOn] = useState(readPref);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const needsInstall = isIos() && !isStandalone(); // iPhone only allows push from the Home Screen app

  // Keep this device's phone-alert subscription in step with the switch (also covers people who enabled it before).
  useEffect(() => {
    (async () => {
      try {
        const s = await pushState();
        if (s === 'on') { resyncPush(); if (!readPref()) { writePref(true); setOn(true); } }
        else if (readPref() && s === 'off' && pushSupported() && pushConfigured() && Notification.permission === 'granted') await enablePush();
      } catch {}
    })();
  }, []);

  async function turnOn() {
    writePref(true); setOn(true);
    await unlockNotificationAudio();
    playNotificationSound('notification');
    if (needsInstall) { setNote('Sound is on. To also get alerts while your phone is locked, tap Share → Add to Home Screen, then open the AADI app from your home screen.'); return; }
    if (pushSupported() && pushConfigured()) {
      const r = await enablePush();
      if (r === 'denied') setNote('Sound is on, but notifications are blocked. Open your phone Settings → Apps/Safari → AADI → Notifications and allow them.');
    } else {
      await requestBrowserNotifications();
    }
  }
  async function turnOff() {
    writePref(false); setOn(false);
    try { await disablePush(); } catch {}
  }
  async function toggle() {
    setNote(''); setBusy(true);
    try { if (on) await turnOff(); else await turnOn(); }
    catch (e) { setNote(e.message || 'Could not change alert settings.'); }
    setBusy(false);
  }

  const Icon = on ? BellRing : BellOff;
  if (variant === 'card') return <div className="sp-sound push-card">
    <span className="sp-sound-text"><Smartphone size={18} /> {on ? 'Alerts are on — you’ll hear a sound and get notified, even when your phone is locked.' : 'Turn on alerts to get a sound and phone notifications for new updates.'}</span>
    <button className={`sp-sound-btn ${on ? 'on' : ''}`} type="button" aria-pressed={on} onClick={toggle} disabled={busy}>{busy ? 'Please wait…' : on ? 'Alerts on' : 'Turn on alerts'}</button>
    {note && <p className="push-note">{note}</p>}
  </div>;
  return <>
    <button type="button" className={`secondary push-top ${on ? 'on' : ''}`} aria-pressed={on} onClick={toggle} disabled={busy} title={on ? 'Alerts are on (sound + phone notifications). Tap to turn off.' : 'Turn on sound and phone notification alerts'}>
      <Icon size={16} /> <span>{on ? 'Alerts on' : 'Alerts off'}</span>
    </button>
    {note && <div className="push-toast" role="status" onClick={() => setNote('')}>{note}</div>}
  </>;
}
