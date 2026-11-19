import { useEffect, useState, useCallback } from 'react';
import { Target, Clock3, XCircle, LogOut } from 'lucide-react';
import { supabase } from '../lib/supabase';
import MemberHome from './MemberHome';

const empty = { full_name: '', phone: '', date_of_birth: '', guardian_name: '', guardian_phone: '', discipline: '10m Air Rifle' };

function shooterFormFromRecord(shooter) {
  return {
    full_name: shooter?.full_name || '',
    phone: shooter?.phone || '',
    date_of_birth: shooter?.date_of_birth || '',
    guardian_name: shooter?.guardian_name || '',
    guardian_phone: shooter?.guardian_phone || '',
    discipline: shooter?.discipline || '10m Air Rifle',
  };
}

export default function ShooterPortal({ session, onLogout }) {
  const [loading, setLoading] = useState(true);
  const [shooter, setShooter] = useState(null);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (silent = false) => {
    const { data, error } = await supabase.from('shooters').select('*').eq('user_id', session.user.id).maybeSingle();
    if (error) {
      if (!silent) setError(error.message);
    } else {
      setShooter(data);
      if (data && data.approval_status === 'rejected') setForm(shooterFormFromRecord(data));
      if (!silent) setError('');
    }
    if (!silent) setLoading(false);
  }, [session.user.id]);

  useEffect(() => {
    load();

    // Keep the member portal in sync with Admin actions (approve/leave/restore)
    // without requiring the shooter to refresh the page. Realtime is used when
    // available, with a lightweight polling fallback for environments where
    // the shooters table is not enabled for Supabase Realtime.
    const channel = supabase.channel(`aadi-shooter-membership-${session.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shooters', filter: `user_id=eq.${session.user.id}` }, () => {
        load(true);
      })
      .subscribe();

    const interval = window.setInterval(() => load(true), 5000);
    return () => {
      window.clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [load, session.user.id]);

  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('');
    const { error } = await supabase.rpc('register_as_shooter', {
      p_full_name: form.full_name, p_phone: form.phone || null, p_date_of_birth: form.date_of_birth || null,
      p_guardian_name: form.guardian_name || null, p_guardian_phone: form.guardian_phone || null, p_discipline: form.discipline,
    });
    setBusy(false);
    if (error) setError(error.message); else load();
  }

  const set = k => e => setForm({ ...form, [k]: e.target.value });

  // Active, approved members get the full dashboard (attendance, scores, fees, QR).
  if (!loading && shooter?.approval_status === 'approved' && shooter.status === 'active') {
    return <MemberHome shooter={shooter} session={session} onLogout={onLogout} />;
  }

  let body;
  if (loading) body = <p className="muted">Loading your membership…</p>;
  else if (!shooter) body = <>
    <h1>Complete your registration</h1>
    <p className="muted">Tell us a little about yourself. The AADI Rifle Shooting team will review and approve your membership.</p>
    <form onSubmit={submit}>
      <label>Full name *<input required value={form.full_name} onChange={set('full_name')} /></label>
      <label>Phone number<input value={form.phone} onChange={set('phone')} /></label>
      <label>Date of birth<input type="date" value={form.date_of_birth} onChange={set('date_of_birth')} /></label>
      <label>Discipline<select value={form.discipline} onChange={set('discipline')}><option>10m Air Rifle</option><option>10m Air Pistol</option><option>50m Rifle</option><option>Other</option></select></label>
      <label>Parent / guardian name (if under 18)<input value={form.guardian_name} onChange={set('guardian_name')} /></label>
      <label>Guardian phone<input value={form.guardian_phone} onChange={set('guardian_phone')} /></label>
      {error && <p className="error">{error}</p>}
      <button className="primary full" disabled={busy}>{busy ? 'Submitting…' : 'Submit for approval'}</button>
    </form>
  </>;
  else if (shooter.approval_status === 'pending') body = <div className="portal-state">
    <span className="state-icon amber"><Clock3 /></span><h1>Waiting for approval</h1>
    <p className="muted">Thanks, {shooter.full_name}. Your registration was received. The academy will review it soon. Check back here after they confirm.</p>
    <div className="portal-id"><small>Membership ID</small><b>{shooter.shooter_code}</b></div>
  </div>;
  else if (shooter.approval_status === 'rejected') body = <div className="portal-state">
    <span className="state-icon red"><XCircle /></span>
    <h1>Application not approved</h1>
    <p className="muted">{shooter.rejection_reason || 'The academy could not approve this registration.'}</p>
    <div className="portal-review-note"><strong>Please review your details and submit again.</strong><span>Your existing membership record stays with the academy. Correct the information below and send a new application for review.</span></div>
    <form onSubmit={submit} className="portal-resubmit-form">
      <label>Full name *<input required value={form.full_name} onChange={set('full_name')} /></label>
      <label>Phone number<input value={form.phone} onChange={set('phone')} /></label>
      <label>Date of birth<input type="date" value={form.date_of_birth} onChange={set('date_of_birth')} /></label>
      <label>Discipline<select value={form.discipline} onChange={set('discipline')}><option>10m Air Rifle</option><option>10m Air Pistol</option><option>50m Rifle</option><option>Other</option></select></label>
      <label>Parent / guardian name (if under 18)<input value={form.guardian_name} onChange={set('guardian_name')} /></label>
      <label>Guardian phone<input value={form.guardian_phone} onChange={set('guardian_phone')} /></label>
      {error && <p className="error">{error}</p>}
      <button className="primary full" disabled={busy}>{busy ? 'Resubmitting…' : 'Edit & resubmit application'}</button>
    </form>
  </div>;
  else if (shooter.status === 'inactive' && shooter.archived_at) body = <div className="portal-state">
    <span className="state-icon amber"><Clock3 /></span>
    <h1>Membership closed</h1>
    <p className="muted">Your leave request was approved by the academy. Your shooter record has been moved to Past Shooters and retained in the academy records.</p>
    <div className="portal-id"><small>Membership ID</small><b>{shooter.shooter_code}</b></div>
  </div>;
  else body = <div className="portal-state">
    <span className="state-icon amber"><Clock3 /></span>
    <h1>Membership on hold</h1>
    <p className="muted">Your membership is currently not active. Please contact the academy.</p>
    <div className="portal-id"><small>Membership ID</small><b>{shooter.shooter_code}</b></div>
  </div>;

  return <div className="login-wrap"><div className="login-card portal-card">
    <div className="brand-mark"><Target /></div>
    <p className="eyebrow">AADI RIFLE SHOOTING</p>
    {body}
    <button className="secondary full portal-out" onClick={onLogout}><LogOut size={15} /> Sign out ({session.user.email})</button>
  </div></div>;
}
