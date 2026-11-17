import { useEffect, useState } from 'react';
import { BellRing, BellOff, Smartphone } from 'lucide-react';
import { disablePush, enablePush, pushState, resyncPush, sendTestPush } from '../lib/push';
import { isIos, isStandalone } from '../lib/pwa';

// variant "top": compact button for the admin top bar.  variant "card": full row for the member home.
export default function PushToggle({ variant = 'top' }) {
  const [state, setState] = useState('loading');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const needsInstall = isIos() && !isStandalone(); // iPhone only allows push from the Home Screen app

  useEffect(() => { (async () => { const s = await pushState(); setState(s); if (s === 'on') resyncPush(); })(); }, []);
  if (state === 'loading' || state === 'unconfigured') return null;
  if (state === 'unsupported' && !needsInstall) return null;

  async function toggle() {
    setNote('');
    if (needsInstall) { setNote('On iPhone, first tap Share → Add to Home Screen, then open the AADI app from your home screen.'); return; }
    if (state === 'denied') { setNote('Notifications are blocked. Open your phone Settings → Apps/Safari → AADI → Notifications and allow them.'); return; }
    setBusy(true);
    try { setState(state === 'on' ? await disablePush() : await enablePush()); }
    catch (e) { setNote(e.message || 'Could not change notification settings.'); }
    setBusy(false);
  }
  async function test() {
    setNote(''); setBusy(true);
    try { await sendTestPush(); setNote('Test sent. Lock your phone — it should appear in a few seconds.'); }
    catch (e) { setNote(e.message); }
    setBusy(false);
  }
  const on = state === 'on';
  const Icon = on ? BellRing : BellOff;
  if (variant === 'card') return <div className="sp-sound push-card">
    <span className="sp-sound-text"><Smartphone size={18} /> {on ? 'Phone alerts are on — you’ll be notified even when your phone is locked.' : 'Get alerts on your phone, even when the app is closed or locked.'}</span>
    <button className={`sp-sound-btn ${on ? 'on' : ''}`} type="button" onClick={toggle} disabled={busy}>{busy ? 'Please wait…' : on ? 'Alerts on' : 'Turn on alerts'}</button>
    {on && <button className="sp-sound-btn" type="button" onClick={test} disabled={busy}>Send test</button>}
    {note && <p className="push-note">{note}</p>}
  </div>;
  return <>
    <button className={`secondary push-top ${on ? 'on' : ''}`} onClick={toggle} disabled={busy} title={on ? 'Phone alerts are on (works when locked). Tap to turn off.' : 'Get alerts on your phone even when the app is closed'}>
      <Icon size={16} /> <span>{on ? 'Phone alerts on' : 'Phone alerts'}</span>
    </button>
    {on && <button className="secondary push-top" onClick={test} disabled={busy} title="Send a test notification to this phone"><span>Test</span></button>}
    {note && <div className="push-toast" role="status" onClick={() => setNote('')}>{note}</div>}
  </>;
}
