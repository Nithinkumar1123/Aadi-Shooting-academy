import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, LogIn, LogOut, Search, UserRoundSearch } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { fmtTime } from '../lib/format';
import { playAttendanceSound } from '../lib/notificationUtils';

// Manual check-in / check-out by name, AADI number or phone. Used when the camera or the shooter's QR is not available.
export default function ManualDesk({ rifleId, onChanged }) {
  const [shooters, setShooters] = useState([]);
  const [open, setOpen] = useState({}); // shooter_id -> checked_in_at for sessions still open
  const [q, setQ] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState(null);

  async function load() {
    const [s, a] = await Promise.all([
      supabase.from('shooters').select('id, full_name, shooter_code, phone').eq('status', 'active').eq('approval_status', 'approved').order('full_name'),
      supabase.from('attendance').select('shooter_id, checked_in_at').is('checked_out_at', null),
    ]);
    if (s.error) setMessage({ type: 'error', text: s.error.message });
    setShooters(s.data || []);
    setOpen(Object.fromEntries((a.data || []).map((r) => [r.shooter_id, r.checked_in_at])));
  }
  useEffect(() => { load(); }, []);

  const term = q.trim().toLowerCase();
  const list = useMemo(() => {
    const base = term ? shooters.filter((s) => `${s.full_name} ${s.shooter_code} ${s.phone || ''}`.toLowerCase().includes(term)) : shooters.filter((s) => open[s.id]);
    return base.slice(0, 8);
  }, [shooters, open, term]);


  async function act(s, checkingIn) {
    setBusyId(s.id); setMessage(null);
    const { data, error } = checkingIn
      ? await supabase.rpc('check_in_manual', { p_shooter_id: s.id, p_rifle_id: rifleId || null })
      : await supabase.rpc('check_out_manual', { p_shooter_id: s.id });
    setBusyId(null);
    if (error) { playAttendanceSound('error'); setMessage({ type: 'error', text: error.message.includes('check_in_manual') || error.message.includes('check_out_manual') ? 'Manual check-in is not set up yet. Run npm run db:setup to apply migration 006.' : error.message }); return; }
    setMessage({ type: 'success', text: checkingIn ? `${data.shooter_name} checked in manually.${data.rifle_code ? ` Rifle ${data.rifle_code} issued.` : ''}` : `${data.shooter_name} checked out manually.${data.rifle_code ? ` Rifle ${data.rifle_code} returned.` : ''}` });
    playAttendanceSound(checkingIn ? 'checkin' : 'checkout'); await load(); onChanged?.();
  }

  return <section className="panel">
    <div className="panel-heading"><div><h2>Manual check-in / check-out</h2><p className="muted">No camera or QR? Find the shooter by name, AADI number or phone. {rifleId ? 'The rifle selected above will be issued on check-in.' : 'To issue a rifle, choose it in the scanner panel first.'}</p></div><span className="scanner-icon"><UserRoundSearch /></span></div>
    <div className="searchbox" style={{ maxWidth: 420, marginBottom: 14 }}><Search size={17} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type name or AADI-… number" /></div>
    {message && <div className={`scan-result ${message.type}`} style={{ marginBottom: 14 }}><CheckCircle2 size={19} /><span>{message.text}</span></div>}
    {!term && <p className="tiny muted" style={{ margin: '0 0 8px' }}>{list.length ? 'Currently in the range:' : 'Nobody is checked in right now. Start typing to find a shooter.'}</p>}
    {term && list.length === 0 && <p className="tiny muted">No active shooter matches “{q}”.</p>}
    <div className="table-wrap"><table><tbody>{list.map((s) => {
      const inside = !!open[s.id];
      return <tr key={s.id}>
        <td><b>{s.full_name}</b></td><td>{s.shooter_code}</td>
        <td>{inside ? <span className="badge green">In since {fmtTime(open[s.id])}</span> : <span className="badge gray">Not checked in</span>}</td>
        <td style={{ textAlign: 'right' }}>{inside
          ? <button className="secondary" disabled={busyId === s.id} onClick={() => act(s, false)}><LogOut size={15} /> Check out</button>
          : <button className="primary" disabled={busyId === s.id} onClick={() => act(s, true)}><LogIn size={15} /> Check in</button>}</td>
      </tr>;
    })}</tbody></table></div>
  </section>;
}
