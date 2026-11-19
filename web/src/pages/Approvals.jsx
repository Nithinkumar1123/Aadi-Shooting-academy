import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Check, X, UserCheck, Download } from 'lucide-react';
import { supabase } from '../lib/supabase';

function makeToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

export default function Approvals({ onChanged }) {
  const [tab, setTab] = useState('pending');
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [card, setCard] = useState(null);
  const [family, setFamily] = useState({});
  const REL = { self: 'Account holder', child: 'Child', other: 'Family member' };

  async function load() {
    const { data, error } = await supabase.from('shooters').select('*')
      .eq('approval_status', tab).not('user_id', 'is', null)
      .order('created_at', { ascending: false });
    if (error) { setError(error.message); return; }
    setRows(data || []);
    // Family accounts: tell the admin when several people share one login/email.
    const ids = [...new Set((data || []).map(r => r.user_id))];
    if (!ids.length) { setFamily({}); return; }
    const { data: all } = await supabase.from('shooters').select('user_id').in('user_id', ids);
    const counts = {};
    (all || []).forEach(r => { counts[r.user_id] = (counts[r.user_id] || 0) + 1; });
    setFamily(counts);
  }
  useEffect(() => { load(); }, [tab]);

  async function approve(s) {
    setBusyId(s.id); setError(''); setNotice('');
    const { error: e1 } = await supabase.rpc('review_shooter', { p_shooter_id: s.id, p_approve: true });
    if (e1) { setError(e1.message); setBusyId(null); return; }
    try {
      const token = makeToken();
      const { error: e2 } = await supabase.rpc('issue_shooter_qr', { p_shooter_id: s.id, p_token: token });
      if (e2) throw e2;
      const image = await QRCode.toDataURL(token, { width: 420, margin: 2, errorCorrectionLevel: 'H' });
      setCard({ shooter: s, image });
      setNotice(`${s.full_name} is approved. Save or print the QR card now; it is not shown again.`);
    } catch (err) {
      setNotice(`${s.full_name} is approved, but the QR card failed (${err.message}). Issue it from the Shooters page.`);
    }
    setBusyId(null); await load(); onChanged?.();
  }

  async function reject(s) {
    const reason = window.prompt(`Reject ${s.full_name}? Add a short reason (optional):`);
    if (reason === null) return;
    setBusyId(s.id); setError(''); setNotice('');
    const { error } = await supabase.rpc('review_shooter', { p_shooter_id: s.id, p_approve: false, p_reason: reason || null });
    if (error) setError(error.message); else setNotice(`${s.full_name} was rejected.`);
    setBusyId(null); await load(); onChanged?.();
  }

  const tabs = [['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected']];
  return <>
    <div className="page-heading"><div>
      <p className="eyebrow">NEW MEMBERS</p><h1>Shooter approvals</h1>
      <p className="muted">People who created an account appear here. Approve them to make them AADI Rifle Shooting members.</p>
    </div></div>
    {error && <div className="alert error">{error}</div>}
    {notice && <div className="alert success">{notice}</div>}
    <section className="panel">
      <div className="mode-switch tabs-3">
        {tabs.map(([k, label]) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{label}</button>)}
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Applicant</th><th>Phone</th><th>Discipline</th><th>Date of birth</th><th>Guardian</th><th>Applied</th><th></th></tr></thead>
          <tbody>{rows.map(s => <tr key={s.id}>
            <td><div className="person-cell"><span className="person-avatar"><UserCheck size={16} /></span><span><b>{s.full_name}</b><small>{s.email}</small>{(family[s.user_id] > 1 || s.relationship === 'child') && <small className="family-tag">{REL[s.relationship] || 'Member'}{family[s.user_id] > 1 ? ` · family account (${family[s.user_id]} members)` : ''}</small>}</span></div></td>
            <td>{s.phone || '—'}</td><td>{s.discipline}</td><td>{s.date_of_birth || '—'}</td>
            <td>{s.guardian_name ? `${s.guardian_name}${s.guardian_phone ? ' · ' + s.guardian_phone : ''}` : '—'}</td>
            <td>{new Date(s.created_at).toLocaleDateString()}</td>
            <td className="row-actions">
              {tab !== 'approved' && <button className="small-outline ok" disabled={busyId === s.id} onClick={() => approve(s)}><Check size={14} /> Approve</button>}
              {tab === 'pending' && <button className="small-outline no" disabled={busyId === s.id} onClick={() => reject(s)}><X size={14} /> Reject</button>}
              {tab === 'rejected' && s.rejection_reason && <small className="muted">{s.rejection_reason}</small>}
            </td>
          </tr>)}</tbody>
        </table>
        {rows.length === 0 && <div className="empty-inline"><UserCheck /><p>No {tab} applications.</p><span>{tab === 'pending' ? 'New shooter sign-ups will show up here for review.' : 'Nothing to show yet.'}</span></div>}
      </div>
    </section>
    {card && <div className="modal-backdrop"><div className="modal qr-modal">
      <div className="modal-head"><div><h2>Shooter QR card</h2><p className="muted">{card.shooter.full_name} · {card.shooter.shooter_code}</p></div><button className="icon-btn" onClick={() => setCard(null)}><X /></button></div>
      <div className="print-card"><div className="print-brand">AADI RIFLE SHOOTING</div><img src={card.image} alt="Shooter QR code" /><h3>{card.shooter.full_name}</h3><p>{card.shooter.shooter_code}</p><small>ACADEMY MEMBERSHIP · SHOW AT CHECK-IN</small></div>
      <p className="tiny muted">Keep this QR private. If it is lost, issue a new one from the Shooters page.</p>
      <button className="primary full" onClick={() => { const a = document.createElement('a'); a.href = card.image; a.download = `${card.shooter.shooter_code}-qr.png`; a.click(); }}><Download size={16} /> Download QR card</button>
      <button className="secondary full" onClick={() => window.print()}>Print card</button>
    </div></div>}
  </>;
}
