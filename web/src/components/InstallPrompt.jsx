import { useEffect, useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { canInstall, isIos, isStandalone, promptInstall, subscribeInstall } from '../lib/pwa';

// Small banner: one-tap install on Android/Chrome, "Add to Home Screen" instructions on iPhone/iPad.
export default function InstallPrompt() {
  const [, tick] = useState(0);
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem('aadi_install_dismissed') === '1'; } catch { return false; } });
  useEffect(() => subscribeInstall(() => tick((n) => n + 1)), []);
  if (hidden || isStandalone()) return null;
  const ios = isIos();
  if (!ios && !canInstall()) return null;
  const close = () => { setHidden(true); try { localStorage.setItem('aadi_install_dismissed', '1'); } catch {} };
  return <div className="install-banner" role="dialog" aria-label="Install AADI app">
    <img src="/icon-192.png" alt="" width="44" height="44" />
    <div className="install-text">
      <b>Install the AADI app</b>
      {ios ? <span>Tap <Share size={14} aria-label="Share" /> then <b>Add to Home Screen</b></span> : <span>Quick access from your home screen</span>}
    </div>
    {!ios && <button className="install-btn" onClick={promptInstall}><Download size={15} /> Install</button>}
    <button className="install-close" onClick={close} aria-label="Dismiss"><X size={16} /></button>
  </div>;
}
