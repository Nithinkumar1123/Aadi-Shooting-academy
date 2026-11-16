import { useCallback, useEffect, useState } from 'react';
import { Activity, ArrowUpRight, CalendarCheck, Clock3, Target, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';

const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const isToday = (iso) => new Date(iso).toDateString() === new Date().toDateString();
// Show the date too when a session is not from today, so the times are never ambiguous.
const fmtWhen = (iso) => isToday(iso) ? fmtTime(iso) : `${new Date(iso).toLocaleDateString([], { day: '2-digit', month: 'short' })}, ${fmtTime(iso)}`;
function fmtDuration(from, to) {
  const mins = Math.max(0, Math.round((new Date(to) - new Date(from)) / 60000));
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m} min`;
}

export default function Dashboard() {
  const [stats, setStats] = useState({ shooters: 0, today: 0, openSessions: 0 });
  const [recent, setRecent] = useState([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(); end.setHours(23, 59, 59, 999);
    const [s, a, o, r] = await Promise.all([
      supabase.from('shooters').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('attendance').select('*', { count: 'exact', head: true }).gte('checked_in_at', start.toISOString()).lte('checked_in_at', end.toISOString()),
      supabase.from('rifle_allocations').select('*', { count: 'exact', head: true }).is('returned_at', null),
      supabase.from('attendance').select('id,checked_in_at,checked_out_at,shooters(full_name,shooter_code)').order('checked_in_at', { ascending: false }).limit(8),
    ]);
    const err = [s.error, a.error, o.error, r.error].find(Boolean);
    if (err) { setError(err.message || 'Could not load dashboard'); return; }
    setError('');
    setStats({ shooters: s.count || 0, today: a.count || 0, openSessions: o.count || 0 });
    setRecent(r.data || []);
  }, []);

  useEffect(() => {
    load();
    // Live updates: refresh whenever a check-in / check-out / rifle issue happens.
    const channel = supabase.channel('aadi-dashboard-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rifle_allocations' }, load)
      .subscribe();
    // Safety net in case the realtime connection drops (e.g. phone sleeps) + refresh on returning to the app.
    const timer = setInterval(load, 60000);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { supabase.removeChannel(channel); clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [load]);

  const dateLabel = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(new Date()).toUpperCase();
  const cards = [
    ['Active shooters', stats.shooters, Users, 'Registered active members'],
    ["Today's attendance", stats.today, CalendarCheck, 'Check-ins recorded today'],
    ['Rifles currently issued', stats.openSessions, Target, 'Awaiting return'],
    ['Live system', 'Online', Activity, 'Supabase connection active'],
  ];

  return <>
    <div className="page-heading">
      <div><p className="eyebrow">{dateLabel}</p><h1>Good to see you, Admin</h1><p className="muted">Here’s what’s happening at your academy today.</p></div>
      <a className="primary link-button" href="/attendance"> <Target size={17} /> Open check-in</a>
    </div>
    {error && <div className="alert error">{error}. Check that the database migration has been applied and your account has admin access.</div>}
    <div className="stat-grid">{cards.map(([label, value, Icon, desc]) =>
      <div className="stat-card" key={label}><div className="stat-top"><span>{label}</span><span className="stat-icon"><Icon size={19} /></span></div><div className="stat-value">{value}</div><p>{desc}</p></div>)}
    </div>
    <div className="content-grid">
      <section className="panel">
        <div className="panel-heading">
          <div><h2>Recent check-ins</h2><p className="muted">Latest shooter sessions · updates live</p></div>
          <a href="/attendance" className="text-link">View attendance <ArrowUpRight size={15} /></a>
        </div>
        {recent.length === 0
          ? <div className="empty-inline"><CalendarCheck /><p>No attendance records yet.</p><span>Scanned check-ins will appear here.</span></div>
          : <div className="table-wrap"><table className="session-table"><thead><tr><th>Shooter</th><th>Shooter ID</th><th>Check-in</th><th>Check-out</th><th>Duration</th><th>Status</th></tr></thead><tbody>
            {recent.map(x => {
              const done = !!x.checked_out_at;
              return <tr key={x.id}>
                <td data-label="Shooter"><b>{x.shooters?.full_name || 'Shooter'}</b></td>
                <td data-label="Shooter ID">{x.shooters?.shooter_code || '—'}</td>
                <td data-label="Check-in">{fmtWhen(x.checked_in_at)}</td>
                <td data-label="Check-out">{done ? fmtWhen(x.checked_out_at) : <span className="dash">—</span>}</td>
                <td data-label="Duration">{done ? fmtDuration(x.checked_in_at, x.checked_out_at) : <span className="live-text">In progress</span>}</td>
                <td data-label="Status"><span className={`badge ${done ? 'gray' : 'green'}`}>{done ? 'Checked out' : <><i className="live-dot" />In session</>}</span></td>
              </tr>;
            })}
          </tbody></table></div>}
      </section>
      <section className="panel quick-panel">
        <div className="panel-heading"><div><h2>Quick actions</h2><p className="muted">Common academy tasks</p></div></div>
        <a href="/shooters" className="quick-action"><span className="quick-icon"><Users /></span><span><b>Register a shooter</b><small>Create profile and QR ID</small></span><ArrowUpRight size={16} /></a>
        <a href="/attendance" className="quick-action"><span className="quick-icon"><Target /></span><span><b>Issue / return rifle</b><small>Scan shooter membership QR</small></span><ArrowUpRight size={16} /></a>
        <div className="tip-box"><Clock3 size={17} /><p><b>Workflow tip</b><br />Scan the shooter’s QR when issuing a rifle, then scan again to complete the session and record the return.</p></div>
      </section>
    </div>
  </>;
}
