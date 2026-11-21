import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, LayoutGrid, Plus, Users, X } from 'lucide-react';
import { MAX_MEMBERS, REL_LABEL, avatarTone, firstName, initials, memberState } from '../lib/family';

export function Avatar({ member, size = 36 }) {
  const photo = member?.avatar_url;
  return <span className="fam-avatar" style={{ width: size, height: size, background: avatarTone(member?.id), fontSize: Math.round(size * 0.38) }} aria-hidden="true">
    {photo ? <>
      <span className="fam-avatar-fallback">{initials(member?.full_name)}</span>
      <img className="fam-avatar-photo" src={photo} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
    </> : initials(member?.full_name)}
  </span>;
}

// Phones get a bottom sheet (easy to reach, never clipped); larger screens get a small dropdown.
function useIsMobile() {
  const query = '(max-width: 720px)';
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMobile(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return mobile;
}

/**
 * Header control for family accounts.
 *  - one member  : shows "Family" and a menu with "Add a family member"
 *  - several     : shows the current member; the menu lists everyone, with unread counts
 * `variant` is 'dark' (on the navy member header) or 'light' (on a white card).
 */
export default function FamilySwitcher({ members, activeId, unread = {}, onSelect, onAdd, onShowAll, variant = 'dark' }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const mobile = useIsMobile();
  const current = members.find((m) => m.id === activeId) || members[0];
  const multi = members.length > 1;
  const others = multi ? members.filter((m) => m.id !== current?.id).reduce((n, m) => n + (unread[m.id] || 0), 0) : 0;

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    let onDoc;
    if (!mobile) { // on phones the backdrop handles outside taps
      onDoc = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
      document.addEventListener('pointerdown', onDoc);
    } else {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
    }
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDoc); };
  }, [open, mobile]);

  if (!current) return null;
  const run = (fn) => () => { setOpen(false); fn?.(); };

  const list = <>
    {members.map((m) => {
      const st = memberState(m);
      const n = unread[m.id] || 0;
      const isCurrent = m.id === current.id;
      return <button key={m.id} type="button" role="menuitem" className={`fam-menu-item${isCurrent ? ' current' : ''}`} onClick={run(() => onSelect?.(m.id))}>
        <Avatar member={m} size={mobile ? 46 : 36} />
        <span className="fam-menu-text">
          <b>{m.full_name}</b>
          <small>{REL_LABEL[m.relationship] || 'Member'}</small>
          <span className={`fam-chip sm ${st.tone}`}><i />{st.label}</span>
        </span>
        {n > 0 && !isCurrent && <span className="fam-count" aria-label={`${n} unread alerts`}>{n}</span>}
        {isCurrent && <span className="fam-tick" aria-label="Currently viewing"><Check size={16} /></span>}
      </button>;
    })}
    <div className="fam-menu-sep" />
    {multi && <button type="button" role="menuitem" className="fam-menu-link" onClick={run(onShowAll)}>
      <span className="fam-link-ico"><LayoutGrid size={18} /></span><span>All family members</span>
    </button>}
    {members.length < MAX_MEMBERS
      ? <button type="button" role="menuitem" className="fam-menu-link add" onClick={run(onAdd)}>
        <span className="fam-link-ico"><Plus size={18} /></span><span>Add a family member</span>
      </button>
      : <p className="fam-menu-limit">Up to {MAX_MEMBERS} members per login. Contact the academy to add more.</p>}
  </>;

  const title = multi ? 'Switch member' : 'Your family';

  return <div className={`fam-switch ${variant}`} ref={box}>
    <button type="button" className="fam-switch-btn" aria-haspopup="menu" aria-expanded={open} aria-label={multi ? `Viewing ${current.full_name}. Switch family member` : 'Family'} onClick={() => setOpen(!open)}>
      {multi ? <><Avatar member={current} size={26} /><span className="fam-switch-name">{firstName(current.full_name)}</span></>
        : <><Users size={17} /><span className="fam-switch-name">Family</span></>}
      {others > 0 && <span className="fam-dot" aria-label={`${others} unread alerts for other members`}>{others > 9 ? '9+' : others}</span>}
      <ChevronDown size={16} className={open ? 'flip' : ''} />
    </button>

    {open && !mobile && <div className="fam-menu" role="menu" aria-label={title}>
      <p className="fam-menu-title">{title}</p>
      {list}
    </div>}

    {open && mobile && createPortal(<>
      <div className="fam-backdrop" onClick={() => setOpen(false)} />
      <div className="fam-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <span className="fam-grab" aria-hidden="true" />
        <div className="fam-sheet-head">
          <div><h2>{title}</h2><p>Tap a person to open their dashboard</p></div>
          <button type="button" className="fam-sheet-x" onClick={() => setOpen(false)} aria-label="Close"><X size={20} /></button>
        </div>
        <div className="fam-sheet-body" role="menu">{list}</div>
      </div>
    </>, document.body)}
  </div>;
}
