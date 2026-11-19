import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bell, Trophy, CalendarCheck, CheckCircle2, Info, LogOut, QrCode, Target, Wallet, LayoutGrid, UserMinus, Clock3, ShieldCheck, Phone, HeartHandshake, ChevronRight, X } from 'lucide-react';
import QRCode from 'qrcode';
import { supabase } from '../lib/supabase';
import { attendanceStats, buildInsights, scorePct, sortScores, summarizeScores } from '../lib/insights';
import { METHODS, daysUntil, duration, feeState, fmtDay, fmtTime, inr } from '../lib/format';
import './portal.css';
import Notifications from './Notifications';
import { shooterDeepLink } from '../lib/notificationRoutes';
import AlertsToggle from '../components/AlertsToggle';
import MemberMatches from './MemberMatches';
import { playNotificationSound, showBrowserNotification, unlockNotificationAudio } from '../lib/notificationUtils';

const TABS = [['overview', 'Overview', LayoutGrid], ['attendance', 'Attendance', CalendarCheck], ['scores', 'Scores', Target], ['matches', 'Matches', Trophy], ['fees', 'Fees', Wallet], ['notifications', 'Notifications', Bell], ['qr', 'My QR', QrCode]];
const SHORT = { overview: 'Home', attendance: 'Visits', scores: 'Scores', matches: 'Matches', fees: 'Fees', notifications: 'Alerts', qr: 'My QR' };
const pct = (n) => `${(Math.round(n * 10) / 10).toFixed(1)}%`;
const TIP_ICON = { improve: AlertTriangle, good: CheckCircle2, info: Info };

// ---- small SVG line chart of score % over time (oldest -> newest) ----
function ScoreChart({ scores }) {
  const pts = scores.slice(-12);
  if (pts.length < 2) return null;
  const W = 600, H = 170, P = { l: 34, r: 12, t: 12, b: 24 };
  const vals = pts.map(scorePct);
  const lo = Math.max(0, Math.floor((Math.min(...vals) - 5) / 5) * 5), hi = Math.min(100, Math.ceil((Math.max(...vals) + 3) / 5) * 5);
  const x = (i) => P.l + (i * (W - P.l - P.r)) / (pts.length - 1);
  const y = (v) => P.t + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - P.t - P.b);
  const line = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const ticks = [lo, Math.round((lo + hi) / 2), hi];
  return <svg className="sp-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Score percentage over your recent sessions">
    {ticks.map((t) => <g key={t}><line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="#e9edf3" /><text x={P.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#8792a4">{t}%</text></g>)}
    <path d={line} fill="none" stroke="#d5a84c" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
    {vals.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="3.5" fill="#fff" stroke="#b98a2e" strokeWidth="2"><title>{`${fmtDay(pts[i].session_date, { day: '2-digit', month: 'short' })}: ${pct(v)}`}</title></circle>)}
    <text x={x(0)} y={H - 6} fontSize="11" fill="#8792a4" textAnchor="start">{fmtDay(pts[0].session_date, { day: '2-digit', month: 'short' })}</text>
    <text x={x(pts.length - 1)} y={H - 6} fontSize="11" fill="#8792a4" textAnchor="end">{fmtDay(pts[pts.length - 1].session_date, { day: '2-digit', month: 'short' })}</text>
  </svg>;
}

function Empty({ icon: Icon, children }) {
  return <div className="sp-empty"><span className="sp-ico"><Icon /></span><p>{children}</p></div>;
}

function QrPass({ shooter, qrImage, qrBusy, onShow, onNew }) {
  return <div className="qr-pass">
    <div className="qr-pass-top"><span className="qr-pass-logo"><img src="/aadi-logo.png" alt="AADI" /></span><span className="qr-pass-tag"><i />Check-in pass</span></div>
    <div className="qr-pass-body">
      {qrImage ? <div className="qr-frame"><img src={qrImage} alt="Your check-in QR code" /><i className="c tl" /><i className="c tr" /><i className="c bl" /><i className="c br" /></div>
        : <button type="button" className="qr-frame qr-empty" disabled={qrBusy} onClick={onShow}><QrCode size={46} /><span>{qrBusy ? 'Preparing…' : 'Tap to show QR'}</span></button>}
      <p className="qr-pass-name">{shooter.full_name}</p>
      <p className="qr-pass-id">{shooter.shooter_code}</p>
    </div>
    <ol className="qr-steps">
      <li><b>1</b><span>Raise your screen brightness</span></li>
      <li><b>2</b><span>Hold the QR 15–20 cm from the scanner</span></li>
      <li><b>3</b><span>Wait for the beep — you’re checked in</span></li>
    </ol>
    {qrImage && <div className="qr-actions">
      <a className="sp-btn ghost" href={qrImage} download={`AADI-${shooter.shooter_code}-QR.png`}>Save image</a>
      <button type="button" className="sp-btn ghost" disabled={qrBusy} onClick={onNew}>Issue new QR</button>
    </div>}
    <p className="sp-note">Keep your QR private. If you lose your phone, issue a new one and the old one stops working.</p>
  </div>;
}

export default function MemberHome({ shooter, session, onLogout, switcher = null, deepLink = null, onDeepLinkUsed = null }) {
  // The saved QR is kept per MEMBER (not per login) so several family members can share one phone.
  // `legacyQrKey` is where single-member accounts stored it before family accounts existed.
  const qrKey = 'aadi_qr_' + shooter.id;
  const legacyQrKey = 'aadi_qr_' + session.user.id;
  const [tab, setTab] = useState(deepLink?.tab || 'overview');
  const [focusMatch, setFocusMatch] = useState(deepLink?.match ? { id: deepLink.match, n: 1 } : null); // match to open on the Matches tab

  // Tapped a notification (in the list, or the push on the lock screen): go to the screen it is about.
  const openFromNotification = useCallback((t) => {
    setTab(t.tab);
    if (t.matchId) setFocusMatch({ id: t.matchId, n: Date.now() });
    window.scrollTo?.({ top: 0, behavior: 'smooth' });
  }, []);
  useEffect(() => { if (deepLink) onDeepLinkUsed?.(); }, []); // the link has been applied to the initial state above
  // Keep the active tab visible in the (horizontally scrolling) tab bar when it was changed by a link.
  useEffect(() => { document.querySelector(`.sp-tabs [data-tab="${tab}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest' }); }, [tab]);
  const [attendance, setAttendance] = useState([]);
  const [scores, setScores] = useState([]);
  const [fees, setFees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [qrImage, setQrImage] = useState('');
  const [qrBusy, setQrBusy] = useState(false);
  const [qrModal, setQrModal] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [exitRequest, setExitRequest] = useState(null);
  const [showExitRequest, setShowExitRequest] = useState(false);
  useEffect(() => {
    if (!showExitRequest) return;
    const onKey = e => { if (e.key === 'Escape') setShowExitRequest(false); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [showExitRequest]);
  const [exitReason, setExitReason] = useState('');
  const [exitBusy, setExitBusy] = useState(false);
  const [exitError, setExitError] = useState('');
  const [expandedScores, setExpandedScores] = useState(() => new Set());

  useEffect(() => {
    const unlock = () => { unlockNotificationAudio(); };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    unlockNotificationAudio();
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  useEffect(() => {
    (async () => {
      const [a, s, f, n, er] = await Promise.all([
        supabase.from('attendance').select('id,checked_in_at,checked_out_at').eq('shooter_id', shooter.id).order('checked_in_at', { ascending: false }).limit(300),
        supabase.from('shooting_scores').select('*').eq('shooter_id', shooter.id).order('session_date', { ascending: false }).limit(200),
        supabase.from('fees').select('*').eq('shooter_id', shooter.id).order('due_date', { ascending: false }),
        supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('audience', 'shooter').eq('shooter_id', shooter.id).is('read_at', null),
        supabase.from('shooter_exit_requests').select('*').eq('shooter_id', shooter.id).order('requested_at', { ascending: false }).limit(1).maybeSingle(),
      ]);
      const err = a.error || s.error || f.error || n.error || er.error;
      if (err) setError(err.message + ' (Have migrations 004, 005, 007 and 008 been applied?)');
      setAttendance(a.data || []); setScores(s.data || []); setFees(f.data || []);
      setUnreadNotifications(n.count || 0);
      setExitRequest(er.data || null);
      setLoading(false);
    })();

    const channel = supabase.channel(`aadi-shooter-live-${shooter.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `shooter_id=eq.${shooter.id}` }, async (payload) => {
        const row = payload.new;
        if (row.audience !== 'shooter' || row.shooter_id !== shooter.id) return;
        playNotificationSound(row.type);
        showBrowserNotification(row.title, row.message, shooterDeepLink({ type: row.type, matchId: row.data?.match_id, shooterId: shooter.id }));
        setUnreadNotifications((n) => n + 1);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'shooting_scores', filter: `shooter_id=eq.${shooter.id}` }, (payload) => {
        const row = payload.new;
        if (!row?.id || row.shooter_id !== shooter.id) return;
        setScores((current) => current.some((item) => item.id === row.id) ? current : [row, ...current]);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'shooting_scores', filter: `shooter_id=eq.${shooter.id}` }, (payload) => {
        const row = payload.new;
        if (!row?.id || row.shooter_id !== shooter.id) return;
        setScores((current) => current.map((item) => item.id === row.id ? { ...item, ...row } : item));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'shooting_scores', filter: `shooter_id=eq.${shooter.id}` }, (payload) => {
        const id = payload.old?.id;
        if (!id) return;
        setScores((current) => current.filter((item) => item.id !== id));
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'attendance', filter: `shooter_id=eq.${shooter.id}` }, (payload) => {
        const row = payload.new;
        if (!row?.id || row.shooter_id !== shooter.id) return;
        setAttendance((current) => current.some((item) => item.id === row.id) ? current : [row, ...current].sort((a, b) => new Date(b.checked_in_at) - new Date(a.checked_in_at)));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'attendance', filter: `shooter_id=eq.${shooter.id}` }, (payload) => {
        const row = payload.new;
        if (!row?.id || row.shooter_id !== shooter.id) return;
        setAttendance((current) => current.map((item) => item.id === row.id ? { ...item, ...row } : item));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'attendance', filter: `shooter_id=eq.${shooter.id}` }, (payload) => {
        const id = payload.old?.id;
        if (!id) return;
        setAttendance((current) => current.filter((item) => item.id !== id));
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'fees', filter: `shooter_id=eq.${shooter.id}` }, (payload) => {
        const row = payload.new;
        if (!row?.id || row.shooter_id !== shooter.id) return;
        setFees((current) => current.some((item) => item.id === row.id) ? current : [row, ...current]);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'fees', filter: `shooter_id=eq.${shooter.id}` }, (payload) => {
        const row = payload.new;
        if (!row?.id || row.shooter_id !== shooter.id) return;
        setFees((current) => current.map((item) => item.id === row.id ? { ...item, ...row } : item));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'fees', filter: `shooter_id=eq.${shooter.id}` }, (payload) => {
        const id = payload.old?.id;
        if (!id) return;
        setFees((current) => current.filter((item) => item.id !== id));
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'shooter_exit_requests', filter: `shooter_id=eq.${shooter.id}` }, (payload) => {
        const row = payload.new;
        if (!row?.id || row.shooter_id !== shooter.id) return;
        setExitRequest(row);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'shooter_exit_requests', filter: `shooter_id=eq.${shooter.id}` }, (payload) => {
        const row = payload.new;
        if (!row?.id || row.shooter_id !== shooter.id) return;
        setExitRequest(row);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'shooters', filter: `id=eq.${shooter.id}` }, () => {})
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [shooter.id]);

  const att = useMemo(() => attendanceStats(attendance), [attendance]);
  const sum = useMemo(() => summarizeScores(scores), [scores]);
  const ordered = useMemo(() => sortScores(scores), [scores]);
  const insights = useMemo(() => buildInsights({ scores, attendance }), [scores, attendance]);
  const unpaid = fees.filter((f) => f.status === 'pending');
  const overdue = unpaid.filter((f) => feeState(f) === 'overdue');
  const dueSoon = unpaid.filter((f) => feeState(f) === 'pending' && daysUntil(f.due_date) <= 3);
  const unpaidTotal = unpaid.reduce((t, f) => t + Number(f.amount), 0);
  const improve = insights.filter((i) => i.tone === 'improve');

  // Show the QR already saved on this device on the welcome card. Never issues a new one by itself.
  useEffect(() => {
    (async () => {
      try {
        const token = localStorage.getItem(qrKey) || localStorage.getItem(legacyQrKey);
        if (!token) return;
        // Valid only if it is THIS member's active QR, so a legacy token can never show on the wrong member.
        const { data } = await supabase.rpc('my_qr_is_valid', { p_token: token });
        if (data) {
          localStorage.setItem(qrKey, token);
          localStorage.removeItem(legacyQrKey);
          setQrImage(await QRCode.toDataURL(token, { width: 420, margin: 2, errorCorrectionLevel: 'H' }));
        }
      } catch (_) {}
    })();
  }, [qrKey, legacyQrKey]);
  useEffect(() => {
    if (!qrModal) return;
    const onKey = (e) => { if (e.key === 'Escape') setQrModal(false); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [qrModal]);
  useEffect(() => { // keep the screen awake while the QR is on screen (best effort)
    if (!(qrModal || tab === 'qr') || !('wakeLock' in navigator)) return;
    let lock = null, off = false;
    navigator.wakeLock.request('screen').then((l) => { if (off) l.release(); else lock = l; }).catch(() => {});
    return () => { off = true; lock?.release?.().catch?.(() => {}); };
  }, [qrModal, tab]);
  const issueNewQr = () => { if (window.confirm('Issue a new QR? Your current QR will stop working.')) showQr(true); };
  function openQr() { setQrModal(true); if (!qrImage && !qrBusy) showQr(false); }

  async function showQr(regenerate = false) {
    setError(''); setQrBusy(true);
    try {
      const key = qrKey;
      let token = regenerate ? null : (localStorage.getItem(key) || localStorage.getItem(legacyQrKey));
      if (token) { // the saved QR may have been replaced from another device
        const { data } = await supabase.rpc('my_qr_is_valid', { p_token: token });
        if (!data) token = null;
      }
      if (!token) {
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        token = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
        const { error } = await supabase.rpc('issue_my_qr', { p_token: token });
        if (error) throw error;
        localStorage.setItem(key, token);
      }
      setQrImage(await QRCode.toDataURL(token, { width: 420, margin: 2, errorCorrectionLevel: 'H' }));
    } catch (e) { setError(e.message); }
    setQrBusy(false);
  }


  async function submitExitRequest(e) {
    e.preventDefault();
    if (exitReason.trim().length < 3) { setExitError('Please provide a short reason so the academy can review your request.'); return; }
    setExitBusy(true); setExitError('');
    const { data, error } = await supabase.rpc('request_shooter_exit', { p_reason: exitReason.trim() });
    if (error) { setExitError(error.message); setExitBusy(false); return; }
    setExitRequest({ id: data, status: 'pending', reason: exitReason.trim(), requested_at: new Date().toISOString() });
    setExitReason(''); setShowExitRequest(false); setExitBusy(false);
  }

  const feeBadge = (f) => { const st = feeState(f); return <span className={`sp-badge ${st === 'paid' ? 'ok' : st === 'overdue' ? 'late' : 'live'}`}>{st === 'paid' ? 'Paid' : st === 'overdue' ? 'Overdue' : 'Due'}</span>; };
  const dueText = (f) => { const d = daysUntil(f.due_date); return d < 0 ? `${-d} day${d === -1 ? '' : 's'} overdue` : d === 0 ? 'due today' : `due in ${d} day${d === 1 ? '' : 's'}`; };

  return <div className="sp-page">
    <header className="sp-top"><div className="sp-wrap">
      <div className="sp-brand"><span className="sp-logo"><img src="/aadi-logo.png" alt="AADI Rifle Shooting Academy" /></span></div>
      <div className="sp-top-actions">{switcher}<button type="button" className="sp-top-qr" onClick={openQr} aria-label="Show my check-in QR"><QrCode size={18} /><span>My QR</span></button>
      <button className="sp-signout" onClick={onLogout} title={session.user.email}><LogOut size={15} /><span>Sign out</span></button></div>
    </div></header>

    <div className="sp-wrap">
      <section className="sp-card">
        <button type="button" className="sp-card-qr" onClick={openQr} aria-label="Show my QR code for check-in">
          {qrImage ? <img src={qrImage} alt="" /> : <span className="qr-ph"><QrCode size={40} /></span>}
          <span>My QR</span>
        </button>
        <p className="sp-hello">Welcome back,</p>
        <h1 className="sp-name">{shooter.full_name}</h1>
        <div className="sp-card-row">
          <div className="sp-field"><small>Membership ID</small><b className="gold">{shooter.shooter_code}</b></div>
          <div className="sp-field"><small>Discipline</small><b>{shooter.discipline}</b></div>
          <span className="sp-pill ok"><i />Active member</span>
        </div>
        <button type="button" className="sp-card-scan" onClick={openQr}>
          <span className="scan-ico">{qrImage ? <img src={qrImage} alt="" /> : <QrCode size={26} />}</span>
          <span className="scan-text"><b>Show check-in QR</b><small>Tap, then hold near the scanner</small></span><ChevronRight size={20} />
        </button>
      </section>

      {error && <p className="sp-error">{error}</p>}

      <nav className="sp-tabs six" aria-label="Sections">
        {TABS.map(([k, label, Icon]) => <button key={k} data-tab={k} className={tab === k ? 'active' : ''} onClick={(e) => { setTab(k); e.currentTarget.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); }} aria-current={tab === k ? 'page' : undefined}><Icon size={22} /><span className="lbl-full">{label}</span><span className="lbl-short">{SHORT[k]}</span>{k === 'notifications' && unreadNotifications > 0 && <span className="sp-tab-count" aria-label={`${unreadNotifications} unread notifications`}>{unreadNotifications > 99 ? '99+' : unreadNotifications}</span>}</button>)}
      </nav>
      <AlertsToggle variant="card" />

      {loading ? <div className="sp-panel"><p className="sp-sub">Loading your progress…</p></div> : <>

      {tab === 'overview' && <>
        {(overdue.length > 0 || dueSoon.length > 0) && <button className={`sp-alert ${overdue.length ? 'late' : ''}`} onClick={() => setTab('fees')}>
          <AlertTriangle size={18} />
          <span><b>{overdue.length ? `${inr(overdue.reduce((t, f) => t + Number(f.amount), 0))} overdue` : `${inr(dueSoon.reduce((t, f) => t + Number(f.amount), 0))} due soon`}</b>
            <small>Please pay at the academy front desk. Tap to see details.</small></span>
        </button>}
        <div className="sp-stats">
          <div className="sp-stat"><div className="sp-stat-ico blue"><CalendarCheck size={22} /></div><div><b>{att.thisMonth}</b><span>Visits this month</span></div></div>
          <div className="sp-stat"><div className="sp-stat-ico gold"><Target size={22} /></div><div><b>{sum.count ? pct(sum.avgPct) : '—'}</b><span>Average score</span></div></div>
          <div className={`sp-stat ${unpaid.length ? 'due' : 'paid'}`}><div className={`sp-stat-ico ${unpaid.length ? 'amber' : 'green'}`}><Wallet size={22} /></div><div><b>{unpaid.length ? inr(unpaidTotal) : 'All paid'}</b><span>{unpaid.length ? 'Fees to pay' : 'No fees pending'}</span></div></div>
        </div>
        <section className="sp-panel">
          <h2>Tips to improve</h2>
          <p className="sp-sub">Simple tips based on your visits and scores. They update every time you open this page.</p>
          {improve.length === 0 && <p className="sp-sub" style={{ marginTop: 12 }}>Nothing flagged right now. Keep shooting and check back after more sessions.</p>}
          <ul className="sp-list">{improve.map((t) => <li key={t.title} className="sp-tip improve"><AlertTriangle size={18} /><div><b>{t.title}</b><span>{t.detail}</span></div></li>)}</ul>
        </section>
        <section className="sp-panel">
          <h2>What’s going well</h2>
          <ul className="sp-list">{insights.filter((i) => i.tone !== 'improve').map((t) => { const Icon = TIP_ICON[t.tone]; return <li key={t.title} className={`sp-tip ${t.tone}`}><Icon size={18} /><div><b>{t.title}</b><span>{t.detail}</span></div></li>; })}</ul>
        </section>
      </>}


      {tab === 'overview' && <section className="sp-panel sp-membership-panel">
        <div className="sp-section-head">
          <div>
            <div className="sp-section-kicker"><ShieldCheck size={15}/> MEMBERSHIP</div>
            <h2>Membership status</h2>
            <p className="sp-sub">Manage your academy membership and request a leave when needed.</p>
          </div>
          <span className="sp-live-pill"><i/> Active member</span>
        </div>
        {exitRequest?.status === 'pending' ? <div className="sp-exit-status pending">
          <span className="sp-exit-icon"><Clock3 size={17}/></span>
          <div><b>Leave request under review</b><span>Your request has been sent to the academy admin. You will be notified after a decision.</span></div>
        </div> : <div className="sp-membership-actions">
          <span className="sp-membership-icon" aria-hidden="true"><UserMinus size={20}/></span>
          <div className="sp-membership-copy"><b>Need to discontinue your membership?</b><span>Submit a request with your reason. An admin must approve it before your account is moved to Past Shooters.</span></div>
          <button className="sp-btn ghost danger-outline" type="button" onClick={() => { setExitError(''); setShowExitRequest(true); }}><UserMinus size={16}/> Request to leave</button>
        </div>}
      </section>}

      {tab === 'attendance' && <section className="sp-panel sp-attendance-panel">
        <div className="sp-section-head">
          <div>
            <div className="sp-section-kicker"><CalendarCheck size={15}/> TRAINING ACTIVITY</div>
            <h2>My attendance</h2>
            <p className="sp-sub">Your front-desk check-in history, session status and training consistency.</p>
          </div>
          <span className="sp-live-pill"><i/> Attendance synced</span>
        </div>

        <div className="sp-attendance-stats">
          <div className="sp-att-stat featured"><span className="sp-att-icon"><CalendarCheck size={17}/></span><div><b>{att.totalDays}</b><span>Days attended</span></div></div>
          <div className="sp-att-stat"><span className="sp-att-icon"><Clock3 size={17}/></span><div><b>{att.thisMonth}</b><span>This month</span></div></div>
          <div className="sp-att-stat"><span className="sp-att-icon"><Target size={17}/></span><div><b>{att.last30}</b><span>Last 30 days</span></div></div>
        </div>

        {attendance.length === 0 ? <Empty icon={CalendarCheck}>No sessions yet. Scan your QR at the front desk on your next visit.</Empty> : <div className="sp-attendance-history">
          <div className="sp-history-head"><div><h3>Recent sessions</h3><p>Latest 40 attendance records</p></div><span>{attendance.length} total</span></div>
          <div className="sp-session-list">{attendance.slice(0, 40).map((a) => {
            const d = new Date(a.checked_in_at);
            const active = !a.checked_out_at;
            return <article className={`sp-session ${active ? 'active' : ''}`} key={a.id}>
              <div className="sp-session-date"><b>{d.getDate()}</b><span>{d.toLocaleDateString('en-IN', { month: 'short' })}</span><small>{d.toLocaleDateString('en-IN', { weekday: 'short' })}</small></div>
              <div className="sp-session-main">
                <div className="sp-session-title"><b>{active ? 'Current training session' : 'Training session'}</b><span>{d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</span></div>
                <div className="sp-session-times">
                  <div><small>CHECK-IN</small><b>{fmtTime(a.checked_in_at)}</b></div>
                  <span className="sp-session-arrow">→</span>
                  <div><small>CHECK-OUT</small><b>{a.checked_out_at ? fmtTime(a.checked_out_at) : '—'}</b></div>
                  <div className="sp-session-duration"><small>DURATION</small><b>{a.checked_out_at ? duration(a.checked_in_at, a.checked_out_at) : 'In progress'}</b></div>
                </div>
              </div>
              <span className={`sp-session-status ${active ? 'live' : 'done'}`}><i/>{active ? 'In session' : 'Completed'}</span>
            </article>;
          })}</div>
        </div>}
      </section>}

      {tab === 'scores' && <section className="sp-panel">
        <h2>My shooting scores</h2>
        <p className="sp-sub">Entered by your coach after each session.</p>
        {scores.length === 0 ? <Empty icon={Target}>No scores recorded yet. Your results and progress chart will appear here.</Empty> : <>
          <div className="sp-summary">
            <div><b>{pct(sum.avgPct)}</b><span>Average</span></div>
            <div><b>{pct(sum.bestPct)}</b><span>Best</span></div>
            <div><b>{sum.trend === null ? '—' : `${sum.trend >= 0 ? '+' : ''}${(Math.round(sum.trend * 10) / 10).toFixed(1)}`}</b><span>Trend (pts)</span></div>
          </div>
          <ScoreChart scores={ordered} />
          <ul className="sp-list">{scores.slice(0, 30).map((s) => {
            const shotValues = Array.isArray(s.shot_values) ? s.shot_values : [];
            const hasShotDetails = shotValues.length > 0;
            const expanded = expandedScores.has(s.id);
            return <li className="sp-row sp-score-row" key={s.id}>
              <div className="sp-grow"><b>{s.event_name}</b><span>{fmtDay(s.session_date)} · {s.shots} shots{s.notes ? ` · ${s.notes}` : ''}</span>{hasShotDetails && <div className="sp-shot-summary"><Target size={13}/> Shot-by-shot details available</div>}</div>
              <div className="sp-score"><b>{Number(s.score)}<small> / {Number(s.max_score)}</small></b><div className="sp-bar"><i style={{ width: `${Math.min(100, scorePct(s))}%` }} /></div></div>
              {hasShotDetails && <button type="button" className="sp-btn ghost sp-shot-toggle" onClick={() => setExpandedScores((old) => { const next = new Set(old); if (next.has(s.id)) next.delete(s.id); else next.add(s.id); return next; })}>{expanded ? 'Hide shots' : 'View shots'}</button>}
              {expanded && hasShotDetails && <div className="sp-shot-details"><div className="sp-shot-details-head"><div><b>Shot-by-shot performance</b><span>{shotValues.length} recorded shots · total {Number(s.score)}</span></div><span className="sp-badge live">Published</span></div><div className="sp-shot-grid">{shotValues.map((v, i) => <div className="sp-shot-cell" key={`${s.id}-${i}`}><small>Shot {i + 1}</small><b>{Number(v).toFixed(1)}</b></div>)}</div></div>}
            </li>;
          })}</ul>
        </>}
      </section>}

      {tab === 'notifications' && <section className="sp-panel"><Notifications compact shooterId={shooter.id} onUnreadChange={setUnreadNotifications} onOpen={openFromNotification} /></section>}

      {tab === 'matches' && <MemberMatches shooter={shooter} focusMatch={focusMatch} />}

      {tab === 'fees' && <section className="sp-panel">
        <h2>My fees</h2>
        <p className="sp-sub">Fees are paid at the academy (cash or UPI). We email you a reminder before the due date and a confirmation once your payment is recorded.</p>
        <div className="sp-summary" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
          <div><b>{unpaid.length ? inr(unpaidTotal) : 'All clear'}</b><span>{unpaid.length ? `${unpaid.length} unpaid fee${unpaid.length === 1 ? '' : 's'}` : 'No fees due'}</span></div>
          <div><b>{inr(fees.filter((f) => f.status === 'paid').reduce((t, f) => t + Number(f.amount), 0))}</b><span>Paid so far</span></div>
        </div>
        {fees.length === 0 ? <Empty icon={Wallet}>No fees have been added for you yet.</Empty> :
          <ul className="sp-list">{fees.map((f) => <li className="sp-row" key={f.id}>
            <div className="sp-grow"><b>{f.title}</b>
              <span>{f.status === 'paid' ? `Paid ${fmtDay(f.paid_at)} · ${METHODS[f.payment_method] || ''}${f.payment_reference ? ` · ${f.payment_reference}` : ''}` : `${inr(f.amount)} · ${fmtDay(f.due_date)} (${dueText(f)})`}</span></div>
            {f.status === 'paid' && <b style={{ fontSize: 14 }}>{inr(f.amount)}</b>}
            {feeBadge(f)}
          </li>)}</ul>}
      </section>}

      {tab === 'qr' && <section className="sp-panel sp-center"><QrPass shooter={shooter} qrImage={qrImage} qrBusy={qrBusy} onShow={() => showQr(false)} onNew={issueNewQr} /></section>}
      </>}
      {!loading && tab === 'overview' && <section className="sp-panel sp-guide">
        <h2>How to use this page</h2>
        <p className="sp-sub">Tap a card to jump straight to that section. Everything here is read-only and safe to explore.</p>
        <ul className="sp-guide-list">
          <li><button type="button" className="sp-guide-card" onClick={() => { setTab('overview'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><span className="sp-guide-ico"><LayoutGrid size={20} /></span><span className="sp-guide-text"><b>Home</b><span>Your progress, tips and membership.</span></span><ChevronRight className="sp-guide-arrow" size={18} /></button></li>
          <li><button type="button" className="sp-guide-card" onClick={() => { setTab('attendance'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><span className="sp-guide-ico"><CalendarCheck size={20} /></span><span className="sp-guide-text"><b>Visits</b><span>Every day you came to train.</span></span><ChevronRight className="sp-guide-arrow" size={18} /></button></li>
          <li><button type="button" className="sp-guide-card" onClick={() => { setTab('scores'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><span className="sp-guide-ico"><Target size={20} /></span><span className="sp-guide-text"><b>Scores</b><span>How you scored in each session.</span></span><ChevronRight className="sp-guide-arrow" size={18} /></button></li>
          <li><button type="button" className="sp-guide-card" onClick={() => { setTab('fees'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><span className="sp-guide-ico"><Wallet size={20} /></span><span className="sp-guide-text"><b>Fees</b><span>What is paid and what is due.</span></span><ChevronRight className="sp-guide-arrow" size={18} /></button></li>
          <li><button type="button" className="sp-guide-card" onClick={() => { setTab('qr'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><span className="sp-guide-ico"><QrCode size={20} /></span><span className="sp-guide-text"><b>My QR</b><span>Show this when you check in at the academy.</span></span><ChevronRight className="sp-guide-arrow" size={18} /></button></li>
        </ul>
      </section>}
      <section className="sp-help">
        <span className="sp-help-ico"><HeartHandshake size={24} /></span>
        <div><b>Need help? We are happy to assist.</b><span>Parents and students can call the academy anytime during training hours.</span></div>
        <a className="sp-btn primary" href="tel:9591123300"><Phone size={18} /> Call 95911 23300</a>
      </section>
    {qrModal && <div className="sp-modal-backdrop" onClick={() => setQrModal(false)}><div className="sp-modal sp-qr-modal" role="dialog" aria-modal="true" aria-label="My QR card" onClick={(e) => e.stopPropagation()}>
      <button className="sp-icon-btn qr-modal-x" type="button" aria-label="Close" onClick={() => setQrModal(false)}>×</button>
      <QrPass shooter={shooter} qrImage={qrImage} qrBusy={qrBusy} onShow={() => showQr(false)} onNew={issueNewQr} />
    </div></div>}
      {showExitRequest && <div className="sp-modal-backdrop" onClick={() => !exitBusy && setShowExitRequest(false)}><div className="sp-modal sp-leave-modal" role="dialog" aria-modal="true" aria-labelledby="leave-title" onClick={e => e.stopPropagation()}>
        <div className="sp-modal-head">
          <span className="sp-leave-icon" aria-hidden="true"><UserMinus size={22}/></span>
          <div className="sp-leave-title"><p className="sp-section-kicker">MEMBERSHIP REQUEST</p><h2 id="leave-title">Request to leave the academy</h2></div>
          <button type="button" className="sp-icon-btn" onClick={() => setShowExitRequest(false)} aria-label="Close"><X size={18}/></button>
        </div>
        <div className="sp-leave-note"><Info size={18}/><p>Your request will be reviewed by an academy admin. If approved, your account will move to Past Shooters and <b>your records will be retained</b>.</p></div>
        <form onSubmit={submitExitRequest}>
          <div className="sp-form-label"><span>Quick reason <em>(optional)</em></span>
            <div className="sp-reason-chips">{['Moving away','Schedule clash','Fees','Lost interest','Other'].map(r => <button type="button" key={r} className={exitReason.trim() === r ? 'on' : ''} onClick={() => setExitReason(r)}>{r}</button>)}</div>
          </div>
          <label className="sp-form-label" htmlFor="leave-reason"><span>Reason for leaving <i>*</i></span>
            <textarea id="leave-reason" required minLength={3} maxLength={500} rows={4} autoFocus value={exitReason} onChange={e => setExitReason(e.target.value)} placeholder="Tell the academy briefly why you are discontinuing your membership." />
            <small className="sp-counter">{exitReason.length}/500</small>
          </label>
          {exitError && <div className="sp-error" role="alert">{exitError}</div>}
          <div className="sp-modal-actions">
            <button type="button" className="sp-btn ghost" onClick={() => setShowExitRequest(false)} disabled={exitBusy}>Cancel</button>
            <button className="sp-btn primary" disabled={exitBusy}>{exitBusy ? 'Sending request…' : 'Send request'}</button>
          </div>
        </form>
      </div></div>}
    </div>
  </div>;
}
