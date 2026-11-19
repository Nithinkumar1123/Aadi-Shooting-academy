import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clipboard, Database, ExternalLink, PauseCircle, PlayCircle, RefreshCw, ShieldCheck, Unplug, UploadCloud, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import receiverScript from '../assets/backup-receiver.gs?raw';

const TABLE_LABEL = { shooters: 'Shooters', rifles: 'Rifles', attendance: 'Attendance', rifle_allocations: 'Rifle issue / return', shooting_scores: 'Training scores', fees: 'Fees & payments', shooter_exit_requests: 'Leave requests', matches: 'Matches', match_registrations: 'Match registrations', match_scores: 'Match scores', match_teams: 'Match teams' };
const when = (iso) => iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const randomSecret = () => { const a = new Uint8Array(18); crypto.getRandomValues(a); return Array.from(a, (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join(''); };

// Admin -> Backup: connect a Google Sheet that receives every addition and change automatically.
export default function Backup() {
  const [st, setSt] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [copied, setCopied] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('backup_status');
    if (error) { setError(/function .*backup_status|could not find/i.test(error.message) ? 'Backup is not set up yet. Ask your developer to apply database update 023 (npm run db:setup).' : error.message); return; }
    setError(''); setSt(data);
  }, []);
  useEffect(() => { load(); const t = window.setInterval(load, 10000); return () => window.clearInterval(t); }, [load]);

  async function run(key, fn, ok) {
    setBusy(key); setError(''); setNotice('');
    try { const r = await fn(); if (r?.error) throw r.error; if (ok) setNotice(typeof ok === 'function' ? ok(r?.data) : ok); }
    catch (e) { setError(e.message || String(e)); }
    setBusy(''); load();
  }
  const copy = async (text, key) => { try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(''), 2000); } catch { setError('Copy failed. Select the text and copy it manually.'); } };

  const connect = (e) => { e.preventDefault(); run('connect', async () => {
    const r = await supabase.rpc('save_backup_config', { p_url: url.trim(), p_secret: secret.trim(), p_enabled: true });
    if (r.error) return r;
    const a = await supabase.rpc('backup_resync_all'); // first full copy of everything already in the app
    return a;
  }, (n) => `Connected. ${n ?? 0} records are being copied to your sheet. This can take a few minutes.`); };

  if (!st && !error) return <section className="panel"><p className="muted">Loading backup settings…</p></section>;

  return <>
    <div className="page-heading"><div><p className="eyebrow">DATA SAFETY</p><h1>Google Sheets backup</h1>
      <p className="muted">Every new shooter, check-in, score, fee and match change is copied to your Google Sheet automatically, with a full change log.</p></div>
      {st?.configured && <div className="row-actions"><button className="secondary" onClick={load}><RefreshCw size={15} /> Refresh</button></div>}</div>

    {error && <div className="alert error">{error}</div>}
    {notice && <div className="alert success">{notice}</div>}

    {st && !st.configured && <section className="panel bk-setup">
      <h2>Connect your Google Sheet <small className="muted">· about 5 minutes, one time</small></h2>
      <ol className="bk-steps">
        <li><b>Create a new Google Sheet</b> and keep it private. It will hold your members’ details.</li>
        <li>In the sheet open <b>Extensions → Apps Script</b>, delete the sample code and paste the script below. Replace <code>CHANGE-THIS-TO-A-LONG-RANDOM-SECRET</code> with your own secret (you can generate one here), then save.
          <div className="bk-copyrow">
            <button type="button" className="secondary" onClick={() => copy(receiverScript, 'script')}><Clipboard size={15} /> {copied === 'script' ? 'Copied!' : 'Copy script'}</button>
            <button type="button" className="secondary" onClick={() => { const s = randomSecret(); setSecret(s); copy(s, 'secret'); }}>{copied === 'secret' ? 'Secret copied!' : 'Generate & copy a secret'}</button>
          </div></li>
        <li>Click <b>Deploy → New deployment → Web app</b>. Set <i>Execute as: Me</i> and <i>Who has access: Anyone</i>, then Deploy and allow access when Google asks. Copy the <b>Web app URL</b>.</li>
        <li>Paste the URL and the same secret below.</li>
      </ol>
      <form className="bk-form" onSubmit={connect}>
        <label>Web app URL<input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" required /></label>
        <label>Secret (same as in the script)<input value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="at least 8 characters" required minLength={8} autoComplete="off" /></label>
        <button className="primary" disabled={busy === 'connect'}><UploadCloud size={16} /> {busy === 'connect' ? 'Connecting…' : 'Connect and back up everything'}</button>
      </form>
    </section>}

    {st?.configured && <>
      <section className="panel">
        <div className="bk-state">
          <span className={`bk-pill ${!st.enabled ? 'paused' : st.failed > 0 ? 'warn' : 'ok'}`}>
            {!st.enabled ? <><PauseCircle size={15} /> Paused</> : st.failed > 0 ? <><AlertCircle size={15} /> Needs attention</> : <><CheckCircle2 size={15} /> Backup is on</>}
          </span>
          <span className="muted">Sheet: {st.url_hint}</span>
        </div>
        <div className="bk-grid">
          <div className="bk-stat"><small>LAST BACKUP</small><b>{when(st.last_sent_at)}</b></div>
          <div className="bk-stat"><small>BACKED UP · LAST 24 H</small><b>{st.backed_up_today}</b></div>
          <div className="bk-stat"><small>WAITING TO SEND</small><b>{st.pending}</b></div>
          <div className={`bk-stat ${st.failed > 0 ? 'bad' : ''}`}><small>FAILED</small><b>{st.failed}</b></div>
        </div>
        {st.failed > 0 && <p className="alert error" style={{ marginTop: 14 }}>Some records could not be delivered after many tries. Check that the Apps Script deployment is still active and the secret matches, then press <b>Reconnect</b> or <b>Back up everything now</b>.</p>}
        <div className="bk-actions">
          <button className="primary" disabled={!!busy} onClick={() => { if (window.confirm('Send a full copy of all data to the sheet now?')) run('all', () => supabase.rpc('backup_resync_all'), (n) => `${n} records queued. They will appear in your sheet within a few minutes.`); }}><UploadCloud size={16} /> {busy === 'all' ? 'Starting…' : 'Back up everything now'}</button>
          <button className="secondary" disabled={!!busy} onClick={() => run('flush', () => supabase.rpc('backup_flush_now'), (n) => n ? `Sending ${n} waiting records…` : 'Nothing is waiting.')}>Send waiting records</button>
          <button className="secondary" disabled={!!busy} onClick={() => run('test', () => supabase.rpc('backup_send_test'), 'Test sent. Open your sheet: the “Backup Status” tab should show the time within a minute.')}>Send test</button>
          <button className="secondary" disabled={!!busy} onClick={() => run('pause', () => supabase.rpc('set_backup_enabled', { p_enabled: !st.enabled }), st.enabled ? 'Backup paused. Changes made while paused are not queued; use “Back up everything now” after resuming.' : 'Backup resumed.')}>{st.enabled ? <><PauseCircle size={15} /> Pause</> : <><PlayCircle size={15} /> Resume</>}</button>
          <button className="secondary" disabled={!!busy} onClick={() => { if (window.confirm('Disconnect the Google Sheet? Your existing sheet stays as it is, but new changes will no longer be copied.')) run('off', () => supabase.rpc('disconnect_backup'), 'Disconnected.'); }}><Unplug size={15} /> Disconnect</button>
        </div>
      </section>

      <section className="panel">
        <h2><Database size={18} style={{ verticalAlign: '-3px', marginRight: 6 }} />What is in the sheet</h2>
        <div className="bk-tabs">{['Change Log', ...st.tables.map((t) => TABLE_LABEL[t] || t), 'Backup Status'].map((t) => <span key={t} className={t === 'Change Log' ? 'main' : ''}>{t}</span>)}</div>
        <ul className="bk-notes">
          <li><b>One tab per area</b>, always holding the latest version of every record.</li>
          <li><b>Change Log</b> adds one line for every addition, edit and deletion, with the time.</li>
          <li>Deleted records are <b>kept</b> and marked in the “_deleted_at” column. Nothing is ever removed from the sheet.</li>
          <li>If Google or the internet is down, changes wait in a queue and are sent automatically later. A full copy also runs every week to repair any gap.</li>
        </ul>
        <p className="bk-privacy"><ShieldCheck size={16} /><span>The sheet contains names, phone numbers and fee details. Keep it private: share it only with people who should see academy records. Passwords and QR codes are never copied.</span></p>
      </section>
    </>}
  </>;
}
