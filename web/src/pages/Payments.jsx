import { useEffect, useMemo, useState } from 'react';
import { BadgeCheck, BellRing, Check, IndianRupee, Mail, Plus, Search, Trash2, Undo2, Users, Wallet, X, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { sendFeeEmails } from '../lib/feeMail';
import { METHODS, daysUntil, feeState, fmtDateTime, fmtDay, inr } from '../lib/format';

const todayStr = () => new Date().toLocaleDateString('en-CA');
const plusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
const monthTitle = () => `Monthly fee - ${new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}`;
const BADGE = { paid: 'green', overdue: 'red', pending: 'amber' };

export default function Payments() {
  const [fees, setFees] = useState([]);
  const [shooters, setShooters] = useState([]);
  const [emails, setEmails] = useState([]);
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null); // { type: 'success' | 'error', text }
  const [busyId, setBusyId] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [payFee, setPayFee] = useState(null);

  async function load() {
    const [f, s, e] = await Promise.all([
      supabase.from('fees').select('*, shooters(full_name, shooter_code, email)').order('due_date', { ascending: false }),
      supabase.from('shooters').select('id, full_name, shooter_code, email').eq('status', 'active').eq('approval_status', 'approved').order('full_name'),
      supabase.from('fee_email_log').select('*, fees(title), shooters(full_name)').order('created_at', { ascending: false }).limit(12),
    ]);
    const err = f.error || s.error || e.error;
    if (err) setError(err.message + ' (Has migration 005 been applied?)'); else setError('');
    setFees(f.data || []); setShooters(s.data || []); setEmails(e.data || []);
  }
  useEffect(() => { load(); }, []);

  const stats = useMemo(() => {
    const now = new Date();
    const unpaid = fees.filter((x) => x.status === 'pending');
    const overdue = unpaid.filter((x) => daysUntil(x.due_date) < 0);
    const paidThisMonth = fees.filter((x) => x.status === 'paid' && new Date(x.paid_at).getMonth() === now.getMonth() && new Date(x.paid_at).getFullYear() === now.getFullYear());
    const sum = (a) => a.reduce((t, x) => t + Number(x.amount), 0);
    return {
      pendingAmt: sum(unpaid), pendingN: unpaid.length,
      overdueAmt: sum(overdue), overdueN: overdue.length,
      paidAmt: sum(paidThisMonth), paidN: paidThisMonth.length,
      owing: new Set(unpaid.map((x) => x.shooter_id)).size,
    };
  }, [fees]);

  const rows = fees.filter((f) => {
    const st = feeState(f);
    if (tab === 'pending' && st !== 'pending') return false;   // due, not yet late
    if (tab === 'overdue' && st !== 'overdue') return false;
    if (tab === 'paid' && st !== 'paid') return false;
    const q = search.trim().toLowerCase();
    return !q || `${f.shooters?.full_name} ${f.shooters?.shooter_code} ${f.title}`.toLowerCase().includes(q);
  });
  const counts = { all: fees.length, pending: fees.filter((f) => feeState(f) === 'pending').length, overdue: fees.filter((f) => feeState(f) === 'overdue').length, paid: fees.filter((f) => f.status === 'paid').length };

  function report(res, okText) {
    if (res.ok) setNotice({ type: 'success', text: okText });
    else setNotice({ type: 'error', text: `${res.failed} email${res.failed === 1 ? '' : 's'} could not be sent: ${res.error || 'unknown error'}` });
  }

  async function remind(f) {
    setBusyId(f.id); setNotice(null);
    report(await sendFeeEmails('reminder', [f.id]), `Reminder emailed to ${f.shooters?.full_name}.`);
    setBusyId(null); load();
  }
  async function resendReceipt(f) {
    setBusyId(f.id); setNotice(null);
    report(await sendFeeEmails('receipt', [f.id]), `Receipt emailed to ${f.shooters?.full_name}.`);
    setBusyId(null); load();
  }
  async function remindAllDue() {
    const targets = fees.filter((f) => f.status === 'pending' && daysUntil(f.due_date) <= 3);
    if (!targets.length) { setNotice({ type: 'success', text: 'Nothing to remind: no unpaid fees are overdue or due within 3 days.' }); return; }
    if (!window.confirm(`Email a reminder to ${targets.length} shooter${targets.length === 1 ? '' : 's'} with fees overdue or due within 3 days?`)) return;
    setBusyId('bulk'); setNotice(null);
    const res = await sendFeeEmails('reminder', targets.map((f) => f.id));
    report(res, `${res.sent} reminder${res.sent === 1 ? '' : 's'} sent.`);
    if (!res.ok && res.sent > 0) setNotice({ type: 'error', text: `${res.sent} sent, ${res.failed} failed: ${res.error || 'unknown error'}` });
    setBusyId(null); load();
  }
  async function undoPaid(f) {
    if (!window.confirm(`Mark "${f.title}" for ${f.shooters?.full_name} as NOT paid again? (No email is sent.)`)) return;
    setBusyId(f.id);
    const { error } = await supabase.rpc('mark_fee_unpaid', { p_fee_id: f.id });
    setNotice(error ? { type: 'error', text: error.message } : { type: 'success', text: 'Marked as pending again.' });
    setBusyId(null); load();
  }
  async function remove(f) {
    if (!window.confirm(`Delete this pending fee "${f.title}" (${inr(f.amount)}) for ${f.shooters?.full_name}?`)) return;
    setBusyId(f.id);
    const { error } = await supabase.from('fees').delete().eq('id', f.id).eq('status', 'pending');
    setNotice(error ? { type: 'error', text: error.message } : { type: 'success', text: 'Fee deleted.' });
    setBusyId(null); load();
  }

  const cards = [
    ['Pending (unpaid)', inr(stats.pendingAmt), Wallet, `${stats.pendingN} fee${stats.pendingN === 1 ? '' : 's'} · ${stats.owing} shooter${stats.owing === 1 ? '' : 's'}`],
    ['Overdue', inr(stats.overdueAmt), AlertTriangle, `${stats.overdueN} past due date`],
    ['Collected this month', inr(stats.paidAmt), BadgeCheck, `${stats.paidN} payment${stats.paidN === 1 ? '' : 's'}`],
    ['Shooters with dues', stats.owing, Users, 'Have at least one unpaid fee'],
  ];
  const tabs = [['all', 'All'], ['pending', 'Pending'], ['overdue', 'Overdue'], ['paid', 'Paid']];

  return <>
    <div className="page-heading"><div>
      <p className="eyebrow">OFFLINE PAYMENTS</p><h1>Fees & payments</h1>
      <p className="muted">Shooters pay at the academy. Record the fee, email reminders, and mark it paid to send the shooter a receipt.</p>
    </div>
    <div className="row-actions">
      <button className="secondary" style={{ margin: 0 }} disabled={busyId === 'bulk'} onClick={remindAllDue}><BellRing size={15} /> Remind all due</button>
      <button className="primary" onClick={() => setAddOpen(true)}><Plus size={16} /> Add fee</button>
    </div></div>

    {error && <div className="alert error">{error}</div>}
    {notice && <div className={`alert ${notice.type === 'error' ? 'error' : 'success'}`}>{notice.text}</div>}

    <div className="stat-grid">{cards.map(([label, value, Icon, desc]) => <div className="stat-card" key={label}>
      <div className="stat-top"><span>{label}</span><span className="stat-icon"><Icon size={19} /></span></div>
      <div className="stat-value">{value}</div><p>{desc}</p></div>)}</div>

    <section className="panel">
      <div className="list-toolbar">
        <div className="mode-switch" style={{ maxWidth: 440, marginBottom: 0 }}>
          {tabs.map(([k, label]) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{label} <span className="count">{counts[k]}</span></button>)}
        </div>
        <div className="searchbox"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search shooter or fee" /></div>
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>Shooter</th><th>Fee</th><th>Amount</th><th>Due</th><th>Status</th><th>Emails</th><th></th></tr></thead>
        <tbody>{rows.map((f) => {
          const st = feeState(f); const d = daysUntil(f.due_date); const busy = busyId === f.id;
          return <tr key={f.id}>
            <td><b>{f.shooters?.full_name}</b><small style={{ display: 'block', color: '#8792a4' }}>{f.shooters?.shooter_code}{!f.shooters?.email && ' · no email'}</small></td>
            <td>{f.title}</td>
            <td><b>{inr(f.amount)}</b></td>
            <td>{fmtDay(f.due_date)}{st !== 'paid' && <small style={{ display: 'block', color: st === 'overdue' ? '#a4433d' : '#8792a4' }}>{d < 0 ? `${-d} day${d === -1 ? '' : 's'} overdue` : d === 0 ? 'due today' : `in ${d} day${d === 1 ? '' : 's'}`}</small>}</td>
            <td><span className={`badge ${BADGE[st]}`}>{st}</span>{st === 'paid' && <small style={{ display: 'block', color: '#8792a4', marginTop: 3 }}>{fmtDay(f.paid_at)} · {METHODS[f.payment_method]}{f.payment_reference ? ` · ${f.payment_reference}` : ''}</small>}</td>
            <td><small style={{ color: '#7e899a' }}>{f.reminder_count > 0 ? `${f.reminder_count} reminder${f.reminder_count === 1 ? '' : 's'}, last ${fmtDay(f.last_reminder_at)}` : st === 'paid' ? '' : 'No reminders yet'}</small></td>
            <td className="row-actions">
              {st !== 'paid' ? <>
                <button className="small-outline" disabled={busy} onClick={() => remind(f)} title="Email a payment reminder"><Mail size={13} /> Remind</button>
                <button className="small-outline ok" disabled={busy} onClick={() => setPayFee(f)}><Check size={13} /> Mark paid</button>
                <button className="small-outline no" disabled={busy} onClick={() => remove(f)} title="Delete fee"><Trash2 size={13} /></button>
              </> : <>
                <button className="small-outline" disabled={busy} onClick={() => resendReceipt(f)}><Mail size={13} /> Resend receipt</button>
                <button className="small-outline" disabled={busy} onClick={() => undoPaid(f)} title="Mark as not paid"><Undo2 size={13} /></button>
              </>}
            </td>
          </tr>;
        })}</tbody>
      </table>
      {rows.length === 0 && <div className="empty-inline"><IndianRupee /><p>No fees to show.</p><span>{fees.length === 0 ? 'Click “Add fee” to create the first monthly fee.' : 'Try another filter.'}</span></div>}
      </div>
    </section>

    <section className="panel">
      <div className="panel-heading"><div><h2>Email activity</h2><p className="muted">Latest reminders and receipts sent to shooters</p></div></div>
      <div className="table-wrap"><table>
        <thead><tr><th>When</th><th>Shooter</th><th>Email</th><th>Fee</th><th>Result</th></tr></thead>
        <tbody>{emails.map((m) => <tr key={m.id}>
          <td>{fmtDateTime(m.created_at)}</td><td>{m.shooters?.full_name || '—'}</td>
          <td>{m.kind === 'receipt' ? 'Payment receipt' : 'Reminder'}{m.trigger === 'auto' && <small style={{ color: '#8792a4' }}> (automatic)</small>}</td>
          <td>{m.fees?.title || '—'}</td>
          <td><span className={`badge ${m.status === 'sent' ? 'green' : 'red'}`}>{m.status}</span>{m.error && <small style={{ display: 'block', color: '#a4433d', maxWidth: 320 }}>{m.error}</small>}</td>
        </tr>)}</tbody>
      </table>
      {emails.length === 0 && <div className="empty-inline"><Mail /><p>No emails sent yet.</p><span>Reminders and payment receipts will be listed here.</span></div>}</div>
    </section>

    {addOpen && <AddFeeModal shooters={shooters} onClose={() => setAddOpen(false)} onDone={(text) => { setAddOpen(false); setNotice({ type: 'success', text }); load(); }} />}
    {payFee && <MarkPaidModal fee={payFee} onClose={() => setPayFee(null)} onDone={(n) => { setPayFee(null); setNotice(n); load(); }} />}
  </>;
}

function AddFeeModal({ shooters, onClose, onDone }) {
  const [who, setWho] = useState('all');
  const [one, setOne] = useState('');
  const [form, setForm] = useState({ title: monthTitle(), amount: '', due_date: plusDays(7), notes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const ids = who === 'all' ? shooters.map((s) => s.id) : one ? [one] : [];

  async function submit(e) {
    e.preventDefault(); setError('');
    if (!ids.length) { setError(who === 'all' ? 'There are no active shooters yet.' : 'Choose a shooter.'); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc('create_fees', { p_shooter_ids: ids, p_title: form.title, p_amount: Number(form.amount), p_due_date: form.due_date, p_notes: form.notes || null });
    setBusy(false);
    if (error) setError(error.message); else onDone(`Fee created for ${data} shooter${data === 1 ? '' : 's'}. Reminders go out automatically before the due date, or use “Remind”.`);
  }
  return <div className="modal-backdrop"><div className="modal">
    <div className="modal-head"><div><h2>Add fee</h2><p className="muted">Create a fee for one shooter or every active shooter.</p></div><button className="icon-btn" onClick={onClose}><X /></button></div>
    <form onSubmit={submit} className="form-grid">
      <div className="mode-switch tabs-2 span-2" style={{ marginBottom: 0 }}>
        <button type="button" className={who === 'all' ? 'active' : ''} onClick={() => setWho('all')}>All active shooters ({shooters.length})</button>
        <button type="button" className={who === 'one' ? 'active' : ''} onClick={() => setWho('one')}>One shooter</button>
      </div>
      {who === 'one' && <label className="span-2">Shooter<select required value={one} onChange={(e) => setOne(e.target.value)}><option value="">Choose…</option>{shooters.map((s) => <option key={s.id} value={s.id}>{s.full_name} ({s.shooter_code})</option>)}</select></label>}
      <label className="span-2">Fee title<input required value={form.title} onChange={set('title')} /></label>
      <label>Amount (₹)<input required type="number" min="1" step="0.01" value={form.amount} onChange={set('amount')} placeholder="1500" /></label>
      <label>Due date<input required type="date" value={form.due_date} onChange={set('due_date')} /></label>
      <label className="span-2">Note (optional)<input value={form.notes} onChange={set('notes')} /></label>
      {error && <p className="error span-2">{error}</p>}
      <div className="modal-actions span-2"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Creating…' : 'Create fee'}</button></div>
    </form>
  </div></div>;
}

function MarkPaidModal({ fee, onClose, onDone }) {
  const [form, setForm] = useState({ method: 'cash', reference: '', paid_on: todayStr() });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const email = fee.shooters?.email;

  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('');
    const { error } = await supabase.rpc('mark_fee_paid', { p_fee_id: fee.id, p_method: form.method, p_reference: form.reference || null, p_paid_on: form.paid_on || null });
    if (error) { setError(error.message); setBusy(false); return; }
    const res = await sendFeeEmails('receipt', [fee.id]);
    setBusy(false);
    onDone(res.ok
      ? { type: 'success', text: `Marked as paid. A receipt was emailed to ${fee.shooters?.full_name}.` }
      : { type: 'error', text: `Marked as paid, but the receipt email failed: ${res.error || 'unknown error'}. Use “Resend receipt” once fixed.` });
  }
  return <div className="modal-backdrop"><div className="modal">
    <div className="modal-head"><div><h2>Mark as paid</h2><p className="muted">{fee.shooters?.full_name} · {fee.title} · <b>{inr(fee.amount)}</b></p></div><button className="icon-btn" onClick={onClose}><X /></button></div>
    <form onSubmit={submit} className="form-grid">
      <label>Payment method<select value={form.method} onChange={set('method')}>{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>Received on<input type="date" required max={todayStr()} value={form.paid_on} onChange={set('paid_on')} /></label>
      <label className="span-2">Reference / receipt no. (optional)<input value={form.reference} onChange={set('reference')} placeholder="e.g. UPI transaction ID" /></label>
      <p className={`alert span-2 ${email ? 'success' : 'error'}`} style={{ margin: 0 }}>{email ? `A “payment received” email will be sent to ${email}.` : 'This shooter has no email on file, so no receipt can be sent. The payment will still be recorded.'}</p>
      {error && <p className="error span-2">{error}</p>}
      <div className="modal-actions span-2"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Confirm payment received'}</button></div>
    </form>
  </div></div>;
}
