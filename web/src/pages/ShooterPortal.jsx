import { useEffect, useState, useCallback } from 'react';
import { Target, Clock3, XCircle, LogOut, Plus, ChevronRight, CheckCircle2, ArrowLeft, Bell } from 'lucide-react';
import { supabase, setActiveMember } from '../lib/supabase';
import MemberHome from './MemberHome';
import MemberForm from '../components/MemberForm';
import FamilySwitcher, { Avatar } from '../components/FamilySwitcher';
import { MAX_MEMBERS, REL_LABEL, firstName, memberState, readChosenMember, readLastMember, saveChosenMember } from '../lib/family';
import { consumeDeepLink } from '../lib/notificationRoutes';
import './family.css';

// Friendly versions of database messages a parent might actually see.
const friendly = (m = '') => /already on your account/i.test(m) ? m
  : /up to \d+ members/i.test(m) ? m
  : /function .*register_as_shooter|could not find the function/i.test(m) ? 'Family accounts are not enabled yet. Ask the academy admin to apply database update 021.'
  : m;

function FamilyShell({ session, onLogout, children, back }) {
  return <div className="sp-page fam-page">
    <header className="sp-top"><div className="sp-wrap">
      <div className="sp-brand"><span className="sp-logo"><img src="/aadi-logo.png" alt="AADI Rifle Shooting Academy" /></span></div>
      <div className="sp-top-actions"><button className="sp-signout" onClick={onLogout} title={session.user.email}><LogOut size={15} /><span>Sign out</span></button></div>
    </div></header>
    <div className="sp-wrap fam-wrap">
      {back && <button type="button" className="fam-back" onClick={back.onClick}><ArrowLeft size={17} /> {back.label}</button>}
      {children}
    </div>
  </div>;
}

export default function ShooterPortal({ session, onLogout }) {
  const uid = session.user.id;
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState([]);
  const [unread, setUnread] = useState({});
  const [loadError, setLoadError] = useState('');
  const [view, setView] = useState('auto');            // auto | picker | add | added
  const [deepLink, setDeepLink] = useState(() => consumeDeepLink()); // from a tapped push notification: tab, match, family member
  const [activeId, setActiveId] = useState(() => deepLink?.member || readChosenMember(uid));
  const [justAdded, setJustAdded] = useState(null);

  const load = useCallback(async (silent = false) => {
    const { data, error } = await supabase.from('shooters').select('*').eq('user_id', uid).order('created_at', { ascending: true });
    if (error) { if (!silent) setLoadError(error.message); }
    else {
      const list = data || [];
      setMembers(list);
      if (list.length > 1) {
        const n = await supabase.from('notifications').select('shooter_id').eq('audience', 'shooter').is('read_at', null).limit(500);
        const counts = {};
        (n.data || []).forEach((r) => { counts[r.shooter_id] = (counts[r.shooter_id] || 0) + 1; });
        setUnread(counts);
      } else setUnread({});
      if (!silent) setLoadError('');
    }
    if (!silent) setLoading(false);
  }, [uid]);

  useEffect(() => {
    load();
    // Keep the portal in sync with Admin actions (approve / reject / leave / restore) without a refresh.
    // Realtime is used when available, with a light polling fallback.
    const channel = supabase.channel(`aadi-shooter-membership-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shooters', filter: `user_id=eq.${uid}` }, () => load(true))
      .subscribe();
    const interval = window.setInterval(() => load(true), 5000);
    return () => { window.clearInterval(interval); supabase.removeChannel(channel); };
  }, [load, uid]);

  const chosen = members.find((m) => m.id === activeId) || null;
  const active = chosen || (members.length === 1 ? members[0] : null);
  // Every data request now carries the member being viewed (set during render so child components,
  // whose effects run first, already use the right member).
  setActiveMember(active?.id);

  function choose(id) { saveChosenMember(uid, id); setActiveId(id); setView('auto'); window.scrollTo?.({ top: 0 }); }

  async function submitMember(payload) {
    const { data, error } = await supabase.rpc('register_as_shooter', payload);
    if (error) return friendly(error.message);
    await load(true);
    const fresh = await supabase.from('shooters').select('*').eq('id', data).maybeSingle();
    setJustAdded(fresh.data || { full_name: payload.p_full_name, id: data });
    if (payload.p_shooter_id) { choose(payload.p_shooter_id); return ''; }
    setView('added');
    return '';
  }

  const switcher = (variant) => <FamilySwitcher members={members} activeId={active?.id} unread={unread} variant={variant}
    onSelect={choose} onAdd={() => setView('add')} onShowAll={() => setView('picker')} />;

  // ---------- states ----------
  if (loading) return <div className="login-wrap"><div className="login-card portal-card"><div className="brand-mark"><Target /></div><p className="muted">Loading your membership…</p></div></div>;

  if (loadError) return <div className="login-wrap"><div className="login-card portal-card">
    <div className="brand-mark"><Target /></div><p className="eyebrow">AADI RIFLE SHOOTING</p>
    <h1>We couldn’t load your account</h1><p className="muted">{loadError}</p>
    <button className="primary full" onClick={() => { setLoading(true); load(); }}>Try again</button>
    <button className="secondary full portal-out" onClick={onLogout}><LogOut size={15} /> Sign out</button>
  </div></div>;

  // Brand-new login: no one registered yet.
  if (members.length === 0) return <FamilyShell session={session} onLogout={onLogout}>
    <section className="fam-card">
      <p className="fam-eyebrow">Welcome to AADI</p>
      <h1>Let’s get you registered</h1>
      <p className="fam-lead">Tell us who is joining. Parents can register themselves and their children under this one login.</p>
      <MemberForm mode="first" members={[]} email={session.user.email} onSubmit={submitMember} />
    </section>
  </FamilyShell>;

  // Add another member.
  if (view === 'add') return <FamilyShell session={session} onLogout={onLogout} back={{ label: 'Back', onClick: () => setView(members.length > 1 ? 'picker' : 'auto') }}>
    <section className="fam-card">
      <p className="fam-eyebrow">Family account</p>
      <h1>Add a family member</h1>
      <p className="fam-lead">Add your child, or yourself, to this login. No new email needed.</p>
      <MemberForm mode="add" members={members} email={session.user.email} onSubmit={submitMember} onCancel={() => setView(members.length > 1 ? 'picker' : 'auto')} />
    </section>
  </FamilyShell>;

  // Confirmation after adding.
  if (view === 'added' && justAdded) return <FamilyShell session={session} onLogout={onLogout}>
    <section className="fam-card fam-done">
      <span className="fam-done-ico"><CheckCircle2 size={34} /></span>
      <h1>{firstName(justAdded.full_name)} is on your account</h1>
      <p className="fam-lead">The academy will review the request. You’ll see the result here, and get an alert if notifications are on.</p>
      {justAdded.shooter_code && <div className="fam-id"><small>Membership ID</small><b>{justAdded.shooter_code}</b></div>}
      <div className="fam-actions stack">
        {members.length < MAX_MEMBERS && <button className="fam-btn primary" onClick={() => setView('add')}><Plus size={17} /> Add another family member</button>}
        <button className="fam-btn ghost" onClick={() => setView(members.length > 1 ? 'picker' : 'auto')}>Done</button>
      </div>
    </section>
  </FamilyShell>;

  // "Who's training today?"
  if (view === 'picker' || !active) {
    const last = readLastMember(uid);
    return <FamilyShell session={session} onLogout={onLogout} back={active ? { label: `Back to ${firstName(active.full_name)}`, onClick: () => setView('auto') } : null}>
      <section className="fam-card fam-picker">
        <p className="fam-eyebrow">{session.user.email}</p>
        <h1>Who’s training today?</h1>
        <p className="fam-lead">Choose a family member to open their dashboard. Each person has their own QR pass, scores and fees.</p>
        <div className="fam-people">
          {members.map((m) => {
            const st = memberState(m);
            const n = unread[m.id] || 0;
            return <button key={m.id} type="button" className="fam-person" onClick={() => choose(m.id)}>
              <Avatar member={m} size={56} />
              <span className="fam-person-name">{m.full_name}</span>
              <span className="fam-person-rel">{REL_LABEL[m.relationship] || 'Member'}{m.id === last && members.length > 1 ? ' · last viewed' : ''}</span>
              <span className={`fam-chip ${st.tone}`}><i />{st.label}</span>
              {n > 0 && <span className="fam-person-alert"><Bell size={13} /> {n} new</span>}
              <ChevronRight size={18} className="fam-person-go" />
            </button>;
          })}
          {members.length < MAX_MEMBERS && <button type="button" className="fam-person add" onClick={() => setView('add')}>
            <span className="fam-add-ico"><Plus size={26} /></span>
            <span className="fam-person-name">Add a family member</span>
            <span className="fam-person-rel">Child, parent or sibling</span>
          </button>}
        </div>
      </section>
    </FamilyShell>;
  }

  const shooter = active;

  // Active, approved members get the full dashboard (attendance, scores, fees, QR).
  if (shooter.approval_status === 'approved' && shooter.status === 'active') {
    const link = deepLink && (!deepLink.member || deepLink.member === shooter.id) ? deepLink : null;
    return <MemberHome key={shooter.id} shooter={shooter} session={session} onLogout={onLogout}
      switcher={switcher('dark')} deepLink={link} onDeepLinkUsed={() => setDeepLink(null)} />;
  }

  // Pending / rejected / closed / on hold: a clear status card, with the family switcher on top.
  let body;
  if (shooter.approval_status === 'pending') body = <div className="portal-state">
    <span className="state-icon amber"><Clock3 /></span><h1>Waiting for approval</h1>
    <p className="muted">Thanks, {shooter.full_name}. Your registration was received. The academy will review it soon. Check back here after they confirm.</p>
    <div className="portal-id"><small>Membership ID</small><b>{shooter.shooter_code}</b></div>
  </div>;
  else if (shooter.approval_status === 'rejected') body = <div className="portal-state">
    <span className="state-icon red"><XCircle /></span>
    <h1>Application not approved</h1>
    <p className="muted">{shooter.rejection_reason || 'The academy could not approve this registration.'}</p>
    <div className="portal-review-note"><strong>Please review the details and submit again.</strong><span>The existing record stays with the academy. Correct the information below and send a new application for review.</span></div>
    <MemberForm key={shooter.id} mode="resubmit" members={members} initial={shooter} email={session.user.email} onSubmit={submitMember} />
  </div>;
  else if (shooter.status === 'inactive' && shooter.archived_at) body = <div className="portal-state">
    <span className="state-icon amber"><Clock3 /></span>
    <h1>Membership closed</h1>
    <p className="muted">The leave request for {shooter.full_name} was approved by the academy. The shooter record has been moved to Past Shooters and retained in the academy records.</p>
    <div className="portal-id"><small>Membership ID</small><b>{shooter.shooter_code}</b></div>
  </div>;
  else body = <div className="portal-state">
    <span className="state-icon amber"><Clock3 /></span>
    <h1>Membership on hold</h1>
    <p className="muted">This membership is currently not active. Please contact the academy.</p>
    <div className="portal-id"><small>Membership ID</small><b>{shooter.shooter_code}</b></div>
  </div>;

  return <div className="login-wrap"><div className="login-card portal-card">
    <div className="fam-status-top"><div className="brand-mark"><Target /></div>{switcher('light')}</div>
    <p className="eyebrow">AADI RIFLE SHOOTING</p>
    {body}
    <button className="secondary full portal-out" onClick={onLogout}><LogOut size={15} /> Sign out ({session.user.email})</button>
  </div></div>;
}
