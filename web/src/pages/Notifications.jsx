import { useEffect, useState } from 'react';
import { AlertCircle, Trophy, Bell, CheckCircle2, CreditCard, RefreshCw, Target, UserCheck, UserMinus, Wallet, CheckCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';


const ICONS = {
  new_registration: UserCheck,
  approval_approved: CheckCircle2,
  approval_rejected: AlertCircle,
  fee_added: Wallet,
  fee_paid: CheckCheck,
  fee_overdue: AlertCircle,
  fee_reminder: AlertCircle,
  score_published: Target,
  shooter_exit_request: UserMinus,
  exit_approved: CheckCircle2,
  exit_rejected: AlertCircle,
  membership_restored: CheckCircle2,
  match_announced: Trophy,
  match_registration: Trophy,
  match_positions_open: Trophy,
  match_results_published: Trophy,
  match_lane_assigned: Target,
};

export default function Notifications({ compact = false, shooterId = null, onUnreadChange = null }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [unread, setUnread] = useState(0);

  async function load() {
    setLoading(true); setError('');
    if (!shooterId) {
      try {
        await supabase.rpc('create_overdue_fee_notifications');
      } catch (_) {
        // Overdue reminder generation is best-effort; notification loading should continue.
      }
    }
    let query = supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(compact ? 8 : 50);
    query = shooterId ? query.eq('audience', 'shooter').eq('shooter_id', shooterId) : query.eq('audience', 'admin');
    const countQuery = supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
    const scopedCountQuery = shooterId ? countQuery.eq('audience', 'shooter').eq('shooter_id', shooterId) : countQuery.eq('audience', 'admin');
    const [{ data, error }, { count: unreadCount, error: countError }] = await Promise.all([query, scopedCountQuery]);
    if (error || countError) setError((error || countError).message + ' (Has migration 007 been applied?)');
    else { const nextUnread = unreadCount || 0; setItems(data || []); setUnread(nextUnread); onUnreadChange?.(nextUnread); }
    setLoading(false);
  }

  useEffect(() => {
    load();
    const channel = supabase.channel(`aadi-notifications-${shooterId || 'admin'}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, (payload) => {
        const row = payload.new;
        const matches = shooterId ? row.audience === 'shooter' && row.shooter_id === shooterId : row.audience === 'admin';
        if (matches) { load(); }
      }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [shooterId]);

  async function markRead(id) {
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
    setItems((old) => old.map((x) => x.id === id ? { ...x, read_at: new Date().toISOString() } : x));
    setUnread((n) => { const next = Math.max(0, n - 1); onUnreadChange?.(next); return next; });
  }
  async function markAllRead() {
    if (!unread) return;
    // Mark EVERY unread notification for this user, not just the few shown on screen
    // (the badge counts all of them, so older unread ones used to keep it stuck on 6).
    const now = new Date().toISOString();
    let q = supabase.from('notifications').update({ read_at: now }).is('read_at', null);
    q = shooterId ? q.eq('audience', 'shooter').eq('shooter_id', shooterId) : q.eq('audience', 'admin');
    const { error } = await q;
    if (error) { setError(error.message); return; }
    setItems((old) => old.map((x) => ({ ...x, read_at: x.read_at || now })));
    setUnread(0); onUnreadChange?.(0);
    load(); // re-sync the real count from the database
  }

  return <>
    {!compact && <div className="page-heading"><div><p className="eyebrow">ACADEMY ACTIVITY</p><h1>Notifications {unread > 0 && <span className="nav-count" style={{ verticalAlign: 'middle' }}>{unread}</span>}</h1><p className="muted">Real-time academy updates for registrations, approvals, attendance, fees and published scores.</p></div><div className="row-actions"><button className="secondary" onClick={markAllRead} disabled={!unread}><CheckCheck size={15}/> Mark all read</button><button className="secondary" onClick={load}><RefreshCw size={15}/> Refresh</button></div></div>}
    {error && <div className="alert error">{error}</div>}
    <section className="panel notification-panel">
      {compact && <div className="panel-heading"><div><h2>Notifications</h2><p className="muted">Latest academy updates</p></div><div className="notification-heading-actions"><span className={`notification-unread-count ${unread ? 'has-unread' : ''}`}>{unread} unread</span>{unread > 0 && <button className="secondary small" onClick={markAllRead}><CheckCheck size={14}/> Mark all read</button>}</div></div>}
      {loading ? <div className="empty-inline"><Bell/><p>Loading notifications…</p></div> : items.length === 0 ? <div className="empty-inline"><CheckCircle2/><p>You’re all caught up</p><span>New academy activity will appear here automatically.</span></div> : <div className="notification-list">{items.map((x) => { const Icon = ICONS[x.type] || Bell; return <article className={`notification-item ${x.read_at ? 'read' : 'unread'}`} key={x.id} onClick={() => !x.read_at && markRead(x.id)}><span className={`notification-icon ${x.type?.includes('overdue') ? 'reminder' : x.type?.includes('registration') || x.type?.includes('approval') ? 'action' : ''}`}><Icon size={18}/></span><div className="notification-copy"><b>{x.title}</b><span>{x.message}</span><small>{new Date(x.created_at).toLocaleString('en-IN')}</small></div>{!x.read_at && <span className="badge amber">New</span>}</article>; })}</div>}
    </section>
    {!compact && <div className="notification-note"><AlertCircle size={17}/><span>Browser notifications can be enabled when prompted. Email fee reminders continue through the existing fee-mail automation.</span></div>}
  </>;
}
