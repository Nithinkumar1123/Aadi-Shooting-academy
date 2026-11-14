import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Target, Trash2, TrendingUp, Trophy, Users, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { fmtDay } from '../lib/format';
import { scorePct, summarizeScores } from '../lib/insights';

const todayStr = () => new Date().toLocaleDateString('en-CA');
const pct = (n) => `${(Math.round(n * 10) / 10).toFixed(1)}%`;

export default function Scores() {
  const [scores, setScores] = useState([]);
  const [shooters, setShooters] = useState([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [open, setOpen] = useState(false);

  async function load() {
    const [s, sh] = await Promise.all([
      supabase.from('shooting_scores').select('*, shooters(full_name, shooter_code)').order('session_date', { ascending: false }).order('created_at', { ascending: false }).limit(500),
      supabase.from('shooters').select('id, full_name, shooter_code').eq('status', 'active').eq('approval_status', 'approved').order('full_name'),
    ]);
    const err = s.error || sh.error;
    setError(err ? err.message + ' (Has migration 004 been applied?)' : '');
    setScores(s.data || []); setShooters(sh.data || []);
  }
  useEffect(() => { load(); }, []);

  const stats = useMemo(() => {
    const since = new Date(); since.setDate(since.getDate() - 30);
    const recent = scores.filter((s) => new Date(s.session_date) >= since);
    const best = scores.reduce((b, s) => (!b || scorePct(s) > scorePct(b) ? s : b), null);
    return { total: scores.length, avg: scores.length ? summarizeScores(scores).avgPct : 0, active: new Set(recent.map((s) => s.shooter_id)).size, best };
  }, [scores]);

  // Per-shooter standing: average of all scores, latest, and change over the recent sessions.
  const standings = useMemo(() => {
    const by = new Map();
    scores.forEach((s) => { if (!by.has(s.shooter_id)) by.set(s.shooter_id, { who: s.shooters, list: [] }); by.get(s.shooter_id).list.push(s); });
    return [...by.values()].map(({ who, list }) => ({ who, n: list.length, ...summarizeScores(list) })).sort((a, b) => b.avgPct - a.avgPct);
  }, [scores]);

  const rows = scores.filter((s) => { const q = search.trim().toLowerCase(); return !q || `${s.shooters?.full_name} ${s.shooters?.shooter_code} ${s.event_name}`.toLowerCase().includes(q); });

  async function remove(s) {
    if (!window.confirm(`Delete this score (${Number(s.score)}/${Number(s.max_score)}) for ${s.shooters?.full_name}?`)) return;
    const { error } = await supabase.from('shooting_scores').delete().eq('id', s.id);
    if (error) setError(error.message); else { setNotice('Score deleted.'); load(); }
  }

  const cards = [
    ['Scores recorded', stats.total, Target, 'All sessions'],
    ['Academy average', stats.total ? pct(stats.avg) : '—', TrendingUp, 'Across all recorded scores'],
    ['Shooters scored (30 days)', stats.active, Users, 'With at least one score'],
    ['Best score', stats.best ? pct(scorePct(stats.best)) : '—', Trophy, stats.best ? stats.best.shooters?.full_name : 'No scores yet'],
  ];

  return <>
    <div className="page-heading"><div>
      <p className="eyebrow">PERFORMANCE</p><h1>Shooting scores</h1>
      <p className="muted">Record each session’s score. Shooters see their progress and tips on where to improve in their own portal.</p>
    </div>
    <button className="primary" onClick={() => setOpen(true)}><Plus size={16} /> Record score</button></div>

    {error && <div className="alert error">{error}</div>}
    {notice && <div className="alert success">{notice}</div>}

    <div className="stat-grid">{cards.map(([label, value, Icon, desc]) => <div className="stat-card" key={label}>
      <div className="stat-top"><span>{label}</span><span className="stat-icon"><Icon size={19} /></span></div>
      <div className="stat-value">{value}</div><p>{desc}</p></div>)}</div>

    <section className="panel">
      <div className="panel-heading"><div><h2>Shooter standings</h2><p className="muted">Ranked by average score. Trend compares the latest 3 sessions with the 3 before.</p></div></div>
      <div className="table-wrap"><table>
        <thead><tr><th>#</th><th>Shooter</th><th>Sessions</th><th>Average</th><th>Best</th><th>Latest</th><th>Trend</th></tr></thead>
        <tbody>{standings.map((r, i) => <tr key={r.who?.shooter_code || i}>
          <td>{i + 1}</td><td><b>{r.who?.full_name}</b><small style={{ display: 'block', color: '#8792a4' }}>{r.who?.shooter_code}</small></td>
          <td>{r.n}</td><td><b>{pct(r.avgPct)}</b></td><td>{pct(r.bestPct)}</td><td>{pct(r.latestPct)}</td>
          <td>{r.trend === null ? <small style={{ color: '#8792a4' }}>needs 4+ sessions</small> : <span className={`badge ${r.trend >= 1 ? 'green' : r.trend <= -1 ? 'red' : 'amber'}`}>{r.trend >= 0 ? '+' : ''}{(Math.round(r.trend * 10) / 10).toFixed(1)} pts</span>}</td>
        </tr>)}</tbody>
      </table>
      {standings.length === 0 && <div className="empty-inline"><Target /><p>No scores yet.</p><span>Click “Record score” after a practice session.</span></div>}</div>
    </section>

    <section className="panel">
      <div className="list-toolbar">
        <div><h2>All scores <span className="count">{scores.length}</span></h2><p className="muted">Newest first</p></div>
        <div className="searchbox"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search shooter or event" /></div>
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>Date</th><th>Shooter</th><th>Event</th><th>Score</th><th>%</th><th>Notes</th><th></th></tr></thead>
        <tbody>{rows.map((s) => <tr key={s.id}>
          <td>{fmtDay(s.session_date)}</td>
          <td><b>{s.shooters?.full_name}</b><small style={{ display: 'block', color: '#8792a4' }}>{s.shooters?.shooter_code}</small></td>
          <td>{s.event_name}<small style={{ display: 'block', color: '#8792a4' }}>{s.shots} shots{s.shot_values ? ' · shot-by-shot' : ''}</small></td>
          <td><b>{Number(s.score)}</b> / {Number(s.max_score)}</td>
          <td>{pct(scorePct(s))}</td>
          <td><small style={{ color: '#7e899a' }}>{s.notes || ''}</small></td>
          <td className="row-actions"><button className="small-outline no" onClick={() => remove(s)} title="Delete score"><Trash2 size={13} /></button></td>
        </tr>)}</tbody>
      </table>
      {rows.length === 0 && scores.length > 0 && <div className="empty-inline"><Search /><p>No matches.</p></div>}</div>
    </section>

    {open && <ScoreModal shooters={shooters} onClose={() => setOpen(false)} onDone={(text) => { setOpen(false); setNotice(text); load(); }} />}
  </>;
}

// Accepts "10.2, 9.8 10.5" (commas, spaces or new lines). Returns an array of numbers, or null if empty.
function parseShots(text) {
  const parts = text.split(/[\s,;]+/).filter(Boolean);
  return parts.length ? parts.map(Number) : null;
}

function ScoreModal({ shooters, onClose, onDone }) {
  const [form, setForm] = useState({ shooter_id: '', session_date: todayStr(), event_name: 'Practice', shots: '10', score: '', max_score: '100', shot_text: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const shotList = parseShots(form.shot_text);
  const shotsOk = !shotList || shotList.every((n) => Number.isFinite(n) && n >= 0 && n <= 10.9);
  const sum = shotList && shotsOk ? Math.round(shotList.reduce((a, b) => a + b, 0) * 10) / 10 : null;

  function changeShots(e) { // keep "out of" in step with the number of shots (10 points per shot)
    const n = e.target.value;
    setForm({ ...form, shots: n, max_score: Number(n) > 0 ? String(Number(n) * 10) : form.max_score });
  }

  async function submit(e) {
    e.preventDefault(); setError('');
    if (!shotsOk) { setError('Shot values must be numbers between 0 and 10.9.'); return; }
    const shots = shotList ? shotList.length : Number(form.shots);
    const score = shotList ? sum : Number(form.score);
    const max = shotList ? Math.max(Number(form.max_score), 0) || shots * 10 : Number(form.max_score);
    if (!form.shooter_id) { setError('Choose a shooter.'); return; }
    if (!(shots > 0)) { setError('Number of shots must be at least 1.'); return; }
    if (!Number.isFinite(score) || score < 0) { setError('Enter a valid score.'); return; }
    if (score > max) { setError(`Score (${score}) cannot be more than the maximum (${max}). For decimal scoring (up to 10.9 a shot) set “Out of” to ${Math.round(shots * 109) / 10}.`); return; }
    setBusy(true);
    const { error } = await supabase.from('shooting_scores').insert({
      shooter_id: form.shooter_id, session_date: form.session_date, event_name: form.event_name.trim() || 'Practice',
      shots, score, max_score: max, shot_values: shotList, notes: form.notes.trim() || null,
    });
    setBusy(false);
    if (error) setError(error.message); else onDone(`Score recorded: ${score}/${max}.`);
  }

  return <div className="modal-backdrop"><div className="modal">
    <div className="modal-head"><div><h2>Record score</h2><p className="muted">Add a session result for a shooter.</p></div><button className="icon-btn" onClick={onClose}><X /></button></div>
    <form onSubmit={submit} className="form-grid">
      <label className="span-2">Shooter<select required value={form.shooter_id} onChange={set('shooter_id')}><option value="">Choose…</option>{shooters.map((s) => <option key={s.id} value={s.id}>{s.full_name} ({s.shooter_code})</option>)}</select></label>
      <label>Date<input type="date" required max={todayStr()} value={form.session_date} onChange={set('session_date')} /></label>
      <label>Event<input value={form.event_name} onChange={set('event_name')} placeholder="Practice, Match, Test…" /></label>
      <label className="span-2">Shot-by-shot values (optional)<input value={form.shot_text} onChange={set('shot_text')} placeholder="e.g. 10.2 9.8 10.5 9.1 10.0 …" />
        <small style={{ color: '#8792a4' }}>{shotList ? (shotsOk ? `${shotList.length} shots · total ${sum}. Score and shots are filled in for you.` : 'Use numbers only, between 0 and 10.9.') : 'Enter every shot to unlock deeper tips (slow starts, late fatigue, weak shots).'}</small></label>
      <label>Shots<input type="number" min="1" required disabled={!!shotList} value={shotList ? shotList.length : form.shots} onChange={changeShots} /></label>
      <label>Score<input type="number" min="0" step="0.1" required={!shotList} disabled={!!shotList} value={shotList ? (sum ?? '') : form.score} onChange={set('score')} placeholder="e.g. 92" /></label>
      <label>Out of<input type="number" min="1" step="0.1" required value={form.max_score} onChange={set('max_score')} /></label>
      <label>Note (optional)<input value={form.notes} onChange={set('notes')} placeholder="Coach comment" /></label>
      {error && <p className="error span-2">{error}</p>}
      <div className="modal-actions span-2"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save score'}</button></div>
    </form>
  </div></div>;
}
