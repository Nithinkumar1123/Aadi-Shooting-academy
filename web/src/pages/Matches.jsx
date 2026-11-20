import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CalendarDays, Eye, EyeOff, MapPin, Medal, Minus, Pencil, Download, FileText, Plus, Printer, Send, Trash2, Trophy, UserMinus, UserPlus, Users, Wand2, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { fmtDay } from '../lib/format';

const todayStr = () => new Date().toLocaleDateString('en-CA');
export const MATCH_STATUS = { open: ['Registration open', 'green'], closed: ['Registration closed', 'amber'], live: ['Live', 'red'], completed: ['Completed', 'gray'] };
const fmt = (n) => (Math.round(Number(n) * 10) / 10).toFixed(1);

// Competition ranking: higher score first, then more inner tens. Equal on both = same place (1, 2, 2, 4).
export function rankRows(rows) {
  const scored = rows.filter((r) => r.score !== null).sort((a, b) => b.score - a.score || b.inner_tens - a.inner_tens || a.name.localeCompare(b.name));
  let prev = null, place = 0;
  scored.forEach((r, i) => { if (!prev || r.score !== prev.score || r.inner_tens !== prev.inner_tens) place = i + 1; r.rank = place; prev = r; });
  const waiting = rows.filter((r) => r.score === null).sort((a, b) => a.name.localeCompare(b.name)).map((r) => ({ ...r, rank: null }));
  return [...scored, ...waiting];
}

export default function Matches() {
  const [matches, setMatches] = useState([]);
  const [counts, setCounts] = useState({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | match
  const [selectedId, setSelectedId] = useState(null);
  const [exporting, setExporting] = useState(null); // match id being prepared

  // Results straight from the matches list: fetch that match's data, then open the sheet or download the CSV.
  async function exportResults(m, kind) {
    setError(''); setExporting(m.id);
    const win = kind === 'sheet' ? window.open('', '_blank') : null; // opened now so pop-up blockers allow it
    if (kind === 'sheet' && !win) { setError('Allow pop-ups to open the results sheet.'); setExporting(null); return; }
    if (win) win.document.write('<p style="font:14px sans-serif;padding:24px">Preparing results…</p>');
    const [r, sc, tm] = await Promise.all([
      supabase.from('match_registrations').select('id, shooter_id, lane_no, relay, sheet_targets, team_id, shooters(full_name, shooter_code, is_guest, guest_club)').eq('match_id', m.id),
      supabase.from('match_scores').select('*').eq('match_id', m.id),
      supabase.from('match_teams').select('*').eq('match_id', m.id).order('created_at'),
    ]);
    setExporting(null);
    const err = r.error || sc.error || tm.error;
    if (err) { win?.close(); setError(err.message); return; }
    if (!(sc.data || []).length) { win?.close(); setError(`No scores have been entered for “${m.name}” yet.`); return; }
    const board = buildBoard(r.data || [], sc.data || [], tm.data || []);
    const teamBoard = m.format === 'team' ? computeTeams(tm.data || [], r.data || [], board) : [];
    if (kind === 'csv') downloadResultsCsv(m, board, teamBoard);
    else { win.document.open(); openResultsDoc(m, board, teamBoard, setError, win); }
  }

  const load = useCallback(async () => {
    const [m, r] = await Promise.all([
      supabase.from('matches').select('*').order('match_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('match_registrations').select('match_id'),
    ]);
    const err = m.error || r.error;
    setError(err ? err.message + ' (Has migration 015 been applied? Run npm run db:setup.)' : '');
    setMatches(m.data || []);
    const c = {}; (r.data || []).forEach((x) => { c[x.match_id] = (c[x.match_id] || 0) + 1; }); setCounts(c);
  }, []);

  useEffect(() => {
    load();
    const ch = supabase.channel('aadi-admin-matches-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_registrations' }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const selected = matches.find((m) => m.id === selectedId);
  if (selected) return <MatchDetail match={selected} onBack={() => setSelectedId(null)} onEdit={() => setEditing(selected)} onChanged={load}
    modal={editing && <MatchModal match={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={(t) => { setEditing(null); setNotice(t); load(); }} />} />;

  async function remove(m) {
    if (!window.confirm(`Delete “${m.name}”? Its registrations and all scores will be removed permanently.`)) return;
    const { error } = await supabase.from('matches').delete().eq('id', m.id);
    if (error) setError(error.message); else { setNotice('Match deleted.'); load(); }
  }

  const upcoming = matches.filter((m) => m.status !== 'completed').length;
  return <>
    <div className="page-heading"><div>
      <p className="eyebrow">COMPETITIONS</p><h1>Matches</h1>
      <p className="muted">Organise a match, let shooters register, enter their scores and decide when they can see their own position.</p>
    </div><button className="primary" onClick={() => setEditing('new')}><Plus size={16} /> Organise match</button></div>

    {error && <div className="alert error">{error}</div>}
    {notice && <div className="alert success">{notice}</div>}

    <div className="stat-grid">
      {[['Total matches', matches.length, Trophy, 'All time'], ['Upcoming / live', upcoming, CalendarDays, 'Not yet completed'], ['Registrations', Object.values(counts).reduce((a, b) => a + b, 0), Users, 'Across all matches'], ['Completed', matches.length - upcoming, Medal, 'Finished matches']].map(([label, value, Icon, desc]) =>
        <div className="stat-card" key={label}><div className="stat-top"><span>{label}</span><span className="stat-icon"><Icon size={19} /></span></div><div className="stat-value">{value}</div><p>{desc}</p></div>)}
    </div>

    {matches.length === 0 ? <section className="panel"><div className="empty-inline"><Trophy /><p>No matches yet.</p><span>Click “Organise match” to create the first one. Shooters are notified automatically.</span></div></section> :
      <div className="match-grid">{matches.map((m) => { const [label, tone] = MATCH_STATUS[m.status] || MATCH_STATUS.open; return <article className="panel match-card" key={m.id}>
        <div className="match-card-top"><span className={`badge ${tone}`}>{label}</span>{m.positions_visible && <span className="badge green"><Eye size={11} style={{ marginRight: 4 }} />Positions shown</span>}</div>
        <h2>{m.name}</h2>
        <p className="muted match-meta"><CalendarDays size={13} /> {fmtDay(m.match_date)} · {m.discipline}</p>
        {m.venue && <p className="muted match-meta"><MapPin size={13} /> {m.venue}</p>}
        <p className="match-count"><Users size={15} /> <b>{counts[m.id] || 0}</b> registered</p>
        {m.format === 'team' && <p className="muted match-meta"><Users size={13} /> Team match · {m.team_size} per team</p>}
        <div className="row-actions">
          <button className="primary" onClick={() => setSelectedId(m.id)}>Manage match</button>
          <button className="small-outline" onClick={() => setEditing(m)} title="Edit details"><Pencil size={13} /></button>
          <button className="small-outline no" onClick={() => remove(m)} title="Delete match"><Trash2 size={13} /></button>
        </div>
        {(m.status === 'completed' || m.status === 'live') && <div className="card-docs">
          <button className="secondary" disabled={exporting === m.id} onClick={() => exportResults(m, 'sheet')}><Printer size={14} /> {exporting === m.id ? 'Preparing…' : 'Results sheet'}</button>
          <button className="secondary" disabled={exporting === m.id} onClick={() => exportResults(m, 'csv')} title="Download as Excel / CSV"><Download size={14} /> Excel</button>
        </div>}
      </article>; })}</div>}

    {editing && <MatchModal match={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={(t) => { setEditing(null); setNotice(t); load(); }} />}
  </>;
}

function MatchDetail({ match, onBack, onEdit, onChanged, modal }) {
  const [regs, setRegs] = useState([]);
  const [scores, setScores] = useState([]);
  const [shooters, setShooters] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [scoreFor, setScoreFor] = useState(null); // { shooter_id, name, existing }
  const [addId, setAddId] = useState('');
  const [busy, setBusy] = useState(false);
  const [livePulse, setLivePulse] = useState(false);
  const [teams, setTeams] = useState([]);
  const [guestOpen, setGuestOpen] = useState(false);

  const load = useCallback(async () => {
    const [r, s, sh, tm] = await Promise.all([
      supabase.from('match_registrations').select('id, shooter_id, registered_at, lane_no, relay, sheet_targets, team_id, shooters(full_name, shooter_code, is_guest, guest_club)').eq('match_id', match.id),
      supabase.from('match_scores').select('*').eq('match_id', match.id),
      supabase.from('shooters').select('id, full_name, shooter_code').eq('status', 'active').eq('approval_status', 'approved').order('full_name'),
      supabase.from('match_teams').select('*').eq('match_id', match.id).order('created_at'),
    ]);
    const err = r.error || s.error || sh.error || tm.error;
    if (err) setError(err.message); else setError('');
    setRegs(r.data || []); setScores(s.data || []); setShooters(sh.data || []); setTeams(tm.data || []);
  }, [match.id]);

  useEffect(() => {
    load();
    const ch = supabase.channel(`aadi-admin-match-${match.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_scores', filter: `match_id=eq.${match.id}` }, () => { load(); setLivePulse(true); setTimeout(() => setLivePulse(false), 1200); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_registrations', filter: `match_id=eq.${match.id}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [match.id, load]);

  const board = useMemo(() => {
    const byShooter = new Map(scores.map((s) => [s.shooter_id, s]));
    return rankRows(regs.map((r) => { const s = byShooter.get(r.shooter_id); return {
      shooter_id: r.shooter_id, reg_id: r.id, name: r.shooters?.full_name || 'Shooter', code: r.shooters?.shooter_code,
      score: s ? Number(s.score) : null, inner_tens: s ? s.inner_tens : 0, notes: s?.notes, score_id: s?.id, existing: s,
      lane: r.lane_no, relay: r.relay || 1, targets: r.sheet_targets || null, sheets: s?.sheet_scores || null,
      guest: !!r.shooters?.is_guest, club: r.shooters?.guest_club, team: teams.find((t) => t.id === r.team_id)?.name || null,
    }; }));
  }, [regs, scores, teams]);

  const teamBoard = useMemo(() => (match.format === 'team' ? computeTeams(teams, regs, board) : []), [match.format, teams, regs, board]);
  const sheetNums = Array.from({ length: match.sheets || 1 }, (_, i) => i + 1);
  const scoredCount = board.filter((r) => r.score !== null).length;
  const leader = board.find((r) => r.rank === 1);
  const available = shooters.filter((s) => !regs.some((r) => r.shooter_id === s.id));

  async function patchMatch(patch, text) {
    setBusy(true);
    const { error } = await supabase.from('matches').update(patch).eq('id', match.id);
    setBusy(false);
    if (error) setError(error.message); else { setNotice(text); onChanged(); }
  }
  async function deleteScore(r) {
    if (!window.confirm(`Delete ${r.name}’s score (${fmt(r.score)})? They stay registered.`)) return;
    const { error } = await supabase.from('match_scores').delete().eq('id', r.score_id);
    if (error) setError(error.message); else { setNotice('Score deleted.'); load(); }
  }
  async function removeShooter(r) {
    if (!window.confirm(`Remove ${r.name} from this match? Their score (if any) will be deleted too.`)) return;
    const { error } = await supabase.from('match_registrations').delete().eq('id', r.reg_id);
    if (error) setError(error.message); else { setNotice(`${r.name} removed.`); load(); }
  }
  async function addShooter() {
    if (!addId) return;
    const { error } = await supabase.from('match_registrations').insert({ match_id: match.id, shooter_id: addId });
    if (error) setError(error.message); else { setAddId(''); setNotice('Shooter added to the match.'); load(); }
  }

  const [label, tone] = MATCH_STATUS[match.status] || MATCH_STATUS.open;
  return <>
    <div className="page-heading"><div>
      <button className="link-button secondary" onClick={onBack} style={{ marginBottom: 12 }}><ArrowLeft size={14} /> All matches</button>
      <p className="eyebrow">MATCH · {fmtDay(match.match_date)}</p>
      <h1>{match.name} <span className={`badge ${tone}`} style={{ verticalAlign: 'middle' }}>{label}</span></h1>
      <p className="muted">{match.discipline}{match.venue ? ` · ${match.venue}` : ''} · {match.sheets} sheets × {match.shots_per_sheet} shots · maximum {fmt(match.max_score)} · <b>{match.format === 'team' ? `Team match (${match.team_size} per team)` : 'Single-player match'}</b></p>
      {match.description && <p className="muted" style={{ marginTop: 4 }}>{match.description}</p>}
    </div><button className="secondary" onClick={onEdit}><Pencil size={15} /> Edit match</button></div>

    {error && <div className="alert error">{error}</div>}
    {notice && <div className="alert success" onClick={() => setNotice('')}>{notice}</div>}

    <section className="panel match-controls">
      <label className="match-control"><span><b>Match status</b><small>Shooters can register only while registration is open.</small></span>
        <select value={match.status} disabled={busy} onChange={(e) => patchMatch({ status: e.target.value }, 'Status updated.')}>
          {Object.entries(MATCH_STATUS).map(([k, [t]]) => <option key={k} value={k}>{t}</option>)}
        </select></label>
      <div className="match-control"><span><b>Shooters can see their position</b><small>{match.positions_visible ? 'ON — each registered shooter sees only their own position, updated live.' : 'OFF — shooters cannot see any position yet.'}</small></span>
        <button className={`switch ${match.positions_visible ? 'on' : ''}`} role="switch" aria-checked={match.positions_visible} disabled={busy}
          onClick={() => patchMatch({ positions_visible: !match.positions_visible }, match.positions_visible ? 'Positions hidden from shooters.' : 'Positions are now visible to shooters.')}>
          <i />{match.positions_visible ? <><Eye size={14} /> Visible</> : <><EyeOff size={14} /> Hidden</>}</button></div>
      <div className="match-control span-all"><span><b>Publish full results to shooters</b><small>{match.status !== 'completed' ? 'Available once the match status is “Completed”. Then every registered shooter can see all positions and sheet scores.' : match.results_published ? 'ON — registered shooters can see everyone’s position and scores.' : 'OFF — shooters still see only their own result.'}</small></span>
        <button className={`switch ${match.results_published ? 'on' : ''}`} role="switch" aria-checked={match.results_published} disabled={busy || match.status !== 'completed'}
          onClick={() => patchMatch({ results_published: !match.results_published }, match.results_published ? 'Full results hidden.' : 'Full results published to shooters.')}>
          <i />{match.results_published ? <><Eye size={14} /> Published</> : <><EyeOff size={14} /> Not published</>}</button></div>
    </section>

    <div className="stat-grid">
      {[['Registered', regs.length, Users, 'Shooters in this match'], ['Scored', `${scoredCount}/${regs.length}`, Medal, 'Scores entered'], ['Leader', leader ? leader.name : '—', Trophy, leader ? `${fmt(leader.score)} points` : 'No scores yet'], ['Top score', leader ? fmt(leader.score) : '—', Trophy, `out of ${fmt(match.max_score)}`]].map(([l, v, Icon, d]) =>
        <div className="stat-card" key={l}><div className="stat-top"><span>{l}</span><span className="stat-icon"><Icon size={19} /></span></div><div className="stat-value" style={typeof v === 'string' && v.length > 8 ? { fontSize: 19 } : null}>{v}</div><p>{d}</p></div>)}
    </div>

    <LanePlan match={match} regs={regs} shooters={shooters} teams={teams} onChanged={() => { load(); onChanged(); }} setError={setError} setNotice={setNotice} />

    {match.format === 'team' && <TeamsPanel match={match} regs={regs} teams={teams} board={board} onChanged={load} setError={setError} setNotice={setNotice} />}

    <section className="panel">
      <div className="panel-heading"><div><h2>Leaderboard <span className={`live-dot ${livePulse ? 'pulse' : ''}`}><i /> Live</span></h2><p className="muted">Sheet-wise scores (S1, S2…), ranked by total then inner tens. Updates the moment a score is saved.</p></div>
        <div className="row-actions results-actions">
          <button className="secondary" onClick={() => openResultsDoc(match, board, teamBoard, setError)} disabled={!scoredCount} title="Opens a print-ready results sheet. Choose “Save as PDF” in the print window to keep a digital copy."><Printer size={15} /> Results sheet</button>
          <button className="secondary" onClick={() => downloadResultsCsv(match, board, teamBoard)} disabled={!scoredCount}><Download size={15} /> Excel / CSV</button>
        </div></div>
      {match.format === 'team' && teamBoard.length > 0 && <div className="team-standings">
        <h3><Trophy size={16} /> Team standings</h3>
        <div className="table-wrap"><table>
          <thead><tr><th>Pos</th><th>Team</th><th>Players (score)</th><th>Total</th><th>Inner tens</th></tr></thead>
          <tbody>{teamBoard.map((t) => <tr key={t.id} className={t.rank && t.rank <= 3 ? `podium p${t.rank}` : ''}>
            <td>{t.rank ? <span className={`rank-chip r${Math.min(t.rank, 4)}`}>{t.rank}</span> : <small style={{ color: '#a1aabb' }}>—</small>}</td>
            <td><b>{t.name}</b>{t.members.length < (match.team_size || 2) && <small style={{ display: 'block', color: '#c0554e' }}>{t.members.length}/{match.team_size} players</small>}</td>
            <td>{t.members.map((m) => `${m.name}${m.guest ? ' (guest)' : ''} ${m.score === null ? '—' : fmt(m.score)}`).join(' · ')}</td>
            <td>{t.scored ? <><b>{fmt(t.total)}</b> <small style={{ color: '#8792a4' }}>/ {fmt(Number(match.max_score) * (match.team_size || 2))}</small></> : <span className="badge gray">Awaiting scores</span>}</td>
            <td>{t.scored ? t.inner : '—'}</td></tr>)}</tbody>
        </table></div>
        <h3 style={{ marginTop: 18 }}>Individual standings</h3>
      </div>}
      <div className="table-wrap"><table>
        <thead><tr><th>Pos</th><th>Shooter</th>{match.format === 'team' && <th>Team</th>}<th>Lane</th>{sheetNums.map((n) => <th key={n}>S{n}</th>)}<th>Total</th><th>Inner tens</th><th></th></tr></thead>
        <tbody>{board.map((r) => <tr key={r.shooter_id} className={r.rank && r.rank <= 3 ? `podium p${r.rank}` : ''}>
          <td>{r.rank ? <span className={`rank-chip r${Math.min(r.rank, 4)}`}>{r.rank}</span> : <small style={{ color: '#a1aabb' }}>—</small>}</td>
          <td><b>{r.name}</b>{r.guest && <span className="guest-tag">Guest</span>}<small style={{ display: 'block', color: '#8792a4' }}>{r.guest && r.club ? `${r.club} · ` : ''}{r.code}</small></td>
          {match.format === 'team' && <td>{r.team ? <b>{r.team}</b> : <small style={{ color: '#c0554e' }}>No team</small>}</td>}
          <td>{r.lane ? <>{(match.relays || 1) > 1 && <small style={{ color: '#8792a4' }}>R{r.relay} · </small>}<b>L{r.lane}</b></> : <small style={{ color: '#a1aabb' }}>—</small>}</td>
          {sheetNums.map((n) => <td key={n}>{r.sheets && r.sheets[n - 1] !== null && r.sheets[n - 1] !== undefined ? fmt(r.sheets[n - 1]) : <small style={{ color: '#c0c7d3' }}>·</small>}</td>)}
          <td>{r.score === null ? <span className="badge gray">Awaiting score</span> : <><b>{fmt(r.score)}</b> <small style={{ color: '#8792a4' }}>/ {fmt(match.max_score)}</small></>}</td>
          <td>{r.score === null ? '—' : r.inner_tens}</td>
          <td className="row-actions">
            <button className="small-outline ok" onClick={() => setScoreFor({ shooter_id: r.shooter_id, reg_id: r.reg_id, name: r.name, lane: r.lane, targets: r.targets, existing: r.existing })}>{r.score === null ? <><Plus size={13} /> Add score</> : <><Pencil size={13} /> Edit</>}</button>
            {r.score !== null && <button className="small-outline no" onClick={() => deleteScore(r)} title="Delete score"><Trash2 size={13} /></button>}
            <button className="small-outline" onClick={() => removeShooter(r)} title="Remove from match"><UserMinus size={13} /></button>
          </td>
        </tr>)}</tbody>
      </table>
      {board.length === 0 && <div className="empty-inline"><Users /><p>No shooters have registered yet.</p><span>They can register from the Matches tab in their portal{match.status === 'open' ? '' : ' (registration is not open right now)'}.</span></div>}</div>
    </section>

    <section className="panel">
      <div className="panel-heading"><div><h2>Add a player</h2><p className="muted">Register a member, or a walk-in guest on the spot — no membership needed.</p></div></div>
      <div className="add-player-grid">
        <div className="add-box"><b>Academy member</b><small>Already a member? Pick them from the list.</small>
          <div className="row-actions" style={{ flexWrap: 'wrap' }}>
            <select className="match-select" value={addId} onChange={(e) => setAddId(e.target.value)}><option value="">Choose a shooter…</option>{available.map((s) => <option key={s.id} value={s.id}>{s.full_name} ({s.shooter_code})</option>)}</select>
            <button className="primary" disabled={!addId} onClick={addShooter}><UserPlus size={15} /> Add to match</button>
          </div></div>
        <div className="add-box guest"><b>Guest / walk-in</b><small>Works even when registration is closed or the match is live. Returning guests are recognised by phone number.</small>
          <button className="primary gold" onClick={() => setGuestOpen(true)}><UserPlus size={15} /> Register guest on the spot</button></div>
      </div>
    </section>

    {guestOpen && <GuestModal match={match} teams={teams} regs={regs} onClose={() => setGuestOpen(false)} onAdded={() => { load(); onChanged(); }} />}
    {scoreFor && <ScoreModal match={match} target={scoreFor} onClose={() => setScoreFor(null)} onDone={(t) => { setScoreFor(null); setNotice(t); load(); }} />}
    {modal}
  </>;
}

function ScoreModal({ match, target, onClose, onDone }) {
  const ex = target.existing;
  const n = match.sheets || 1;
  const per = match.shots_per_sheet || 10;
  const S = match.sighting_sheets || 0; // sighting sheets: shown first, never counted
  const tno = (i) => target.targets?.[S + i] || ''; // allocated target sheet number of scored sheet i
  const sno = (i) => target.targets?.[i] || '';     // ... of sighting sheet i
  const perSheetMax = Math.round((Number(match.max_score) / n) * 10) / 10;
  const shotMax = Math.round((Number(match.max_score) / (n * per)) * 10) / 10;
  const hasShots = Array.isArray(ex?.shot_scores) && ex.shot_scores.length > 0;
  const legacyTotal = ex && !ex.sheet_scores ? Number(ex.score) : null;
  const [mode, setMode] = useState(ex && !hasShots && ex.sheet_scores ? 'totals' : 'shots');
  const [sheet, setSheet] = useState(0);
  const [shots, setShots] = useState(() => Array.from({ length: n }, (_, i) => Array.from({ length: per }, (_, j) => {
    const v = ex?.shot_scores?.[i]?.[j]; return v === null || v === undefined ? '' : String(Number(v)); })));
  const [sight, setSight] = useState(() => Array.from({ length: S }, (_, i) => Array.from({ length: per }, (_, j) => {
    const v = ex?.sighting_scores?.[i]?.[j]; return v === null || v === undefined ? '' : String(Number(v)); })));
  const [totals, setTotals] = useState(() => Array.from({ length: n }, (_, i) => (ex?.sheet_scores && ex.sheet_scores[i] !== null && ex.sheet_scores[i] !== undefined ? String(Number(ex.sheet_scores[i])) : '')));
  const [inner, setInner] = useState(ex ? String(ex.inner_tens) : '0');
  const [notes, setNotes] = useState(ex?.notes || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const r1 = (x) => Math.round(x * 10) / 10;
  const num = (v) => (String(v).trim() === '' ? null : Number(v));
  const badShot = (v) => { const x = num(v); return x !== null && (!Number.isFinite(x) || x < 0 || x > shotMax); };

  // per-sheet totals + completeness, from whichever mode is active
  const sheetInfo = Array.from({ length: n }, (_, i) => {
    if (mode === 'shots') { const vals = shots[i].map(num).filter((x) => x !== null && Number.isFinite(x)); return { total: r1(vals.reduce((a, b) => a + b, 0)), count: vals.length, bad: shots[i].some(badShot) }; }
    const x = num(totals[i]); return { total: x === null || !Number.isFinite(x) ? 0 : x, count: x === null ? 0 : per, bad: x !== null && (!Number.isFinite(x) || x < 0 || x > perSheetMax) };
  });
  const anyBad = sheetInfo.some((s) => s.bad);
  const entered = sheetInfo.filter((s) => s.count > 0);
  const total = r1(sheetInfo.reduce((a, s) => a + s.total, 0));
  const shotsDone = sheetInfo.reduce((a, s) => a + (mode === 'shots' ? s.count : 0), 0);

  const isSight = mode === 'shots' && sheet < S;
  const k = sheet - S; // index of the scored sheet when not on a sighting tab
  const curShots = isSight ? sight[sheet] : shots[k] || [];
  const sightInfo = sight.map((row) => ({ count: row.filter((v) => num(v) !== null).length, bad: row.some(badShot) }));
  const setShot = (j, val) => (isSight
    ? setSight(sight.map((row, i) => (i === sheet ? row.map((v, q) => (q === j ? val : v)) : row)))
    : setShots(shots.map((row, i) => (i === k ? row.map((v, q) => (q === j ? val : v)) : row))));
  function onShotChange(j, e) {
    const val = e.target.value.replace(',', '.').replace(/[^0-9.]/g, '');
    setShot(j, val);
    // 10.4 / 9.8 style entries are complete after one decimal – jump to the next shot automatically
    if (/^\d{1,2}\.\d$/.test(val)) { const nxt = e.target.form?.querySelector(`[data-shot="${j + 1}"]`); if (nxt) nxt.focus(); }
  }
  function onShotKey(j, e) { if (e.key === 'Enter') { e.preventDefault(); const nxt = e.currentTarget.form?.querySelector(`[data-shot="${j + 1}"]`); if (nxt) nxt.focus(); else if (sheet < S + n - 1) setSheet(sheet + 1); } }

  async function submit(e) {
    e.preventDefault(); setError('');
    if (anyBad || sightInfo.some((x) => x.bad)) { setError(mode === 'shots' ? `Each shot must be between 0 and ${fmt(shotMax)}.` : `Each sheet must be between 0 and ${fmt(perSheetMax)}.`); return; }
    if (entered.length === 0) { setError(mode === 'shots' ? 'Enter at least one shot.' : 'Enter at least one sheet score.'); return; }
    const it = Number(inner);
    if (!Number.isInteger(it) || it < 0) { setError('Inner tens must be a whole number (0 or more).'); return; }
    setBusy(true);
    const sheetScores = sheetInfo.map((s) => (s.count > 0 ? r1(s.total) : null));
    const shotPayload = mode === 'shots' ? shots.map((row) => row.map(num)) : null;
    const row = { match_id: match.id, shooter_id: target.shooter_id, score: total, sheet_scores: sheetScores, shot_scores: shotPayload, sighting_scores: mode === 'shots' && sight.some((r) => r.some((v) => num(v) !== null)) ? sight.map((r) => r.map(num)) : null, inner_tens: it, notes: notes.trim() || null };
    const { error } = ex ? await supabase.from('match_scores').update(row).eq('id', ex.id) : await supabase.from('match_scores').insert(row);
    setBusy(false);
    if (error) setError(error.message); else onDone(`${target.name}: ${entered.length} of ${n} sheets saved · total ${fmt(total)}.`);
  }

  return <div className="modal-backdrop"><div className="modal score-modal">
    <div className="modal-head"><div><h2>{ex ? 'Edit score' : 'Add score'}</h2><p className="muted">{target.name} · {match.name}{target.lane ? ` · Lane ${target.lane}` : ''}</p></div><button className="icon-btn" onClick={onClose}><X /></button></div>
    {legacyTotal !== null && <div className="alert error" style={{ fontSize: 12 }}>This shooter has a total of {fmt(legacyTotal)} saved without sheet details. Entering scores below will replace it.</div>}
    <form onSubmit={submit} className="form-grid">
      <div className="span-2 mode-switch2" role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'shots'} className={mode === 'shots' ? 'on' : ''} onClick={() => setMode('shots')}>Shot by shot</button>
        <button type="button" role="tab" aria-selected={mode === 'totals'} className={mode === 'totals' ? 'on' : ''} onClick={() => setMode('totals')}>Sheet totals only</button>
      </div>

      {mode === 'shots' ? <>
        <div className="span-2 sheet-tabs" role="tablist">
          {sight.map((_, i) => <button type="button" role="tab" key={`s${i}`} aria-selected={sheet === i} className={`sight ${sheet === i ? 'on' : ''}`} onClick={() => setSheet(i)}>
            <span>{sno(i) ? `#${sno(i)}` : `Sighting ${i + 1}`}</span><b>{sightInfo[i].count ? `${sightInfo[i].count} shots` : 'Not scored'}</b><small>practice</small></button>)}
          {sheetInfo.map((s, i) => <button type="button" role="tab" key={i} aria-selected={sheet === S + i} className={`${sheet === S + i ? 'on' : ''} ${s.count === per ? 'done' : ''} ${s.bad ? 'bad' : ''}`} onClick={() => setSheet(S + i)}>
            <span>{tno(i) ? `#${tno(i)}` : `Sheet ${i + 1}`}</span><b>{s.count ? fmt(s.total) : '—'}</b><small>{s.count}/{per}</small></button>)}</div>
        <div className={`span-2 shot-panel ${isSight ? 'sight' : ''}`}>
          <div className="shot-head"><b>{isSight ? (sno(sheet) ? `Target sheet ${sno(sheet)}` : `Sighting sheet ${sheet + 1}`) : (tno(k) ? `Target sheet ${tno(k)}` : `Sheet ${k + 1}`)}{!isSight && tno(k) && <small className="series-tag">Series {k + 1} of {n}</small>}{isSight && sno(sheet) && <small className="series-tag">Sighting {sheet + 1} of {S}</small>}</b>{isSight && <span className="sight-note">Weapon set-up — not counted in the total or the ranking. Entering these shots is optional.</span>}<small>Type each shot (0–{fmt(shotMax)}). It moves to the next box by itself.</small></div>
          <div className="shot-grid">{curShots.map((v, j) => <label key={`${sheet}-${j}`} className={badShot(v) ? 'bad' : v !== '' ? 'filled' : ''}><span>Shot {j + 1}</span>
            <input data-shot={j} inputMode="decimal" autoComplete="off" autoFocus={j === 0} value={v} placeholder="–" onChange={(e) => onShotChange(j, e)} onKeyDown={(e) => onShotKey(j, e)} /></label>)}</div>
          <div className="shot-foot">{isSight ? <><span>Not counted</span><small>Sighting shots never change the score.</small></> : <><span>{tno(k) ? `Target ${tno(k)}` : `Sheet ${k + 1}`} total</span><b>{sheetInfo[k].bad ? '—' : fmt(sheetInfo[k].total)}</b><small>/ {fmt(perSheetMax)} · {sheetInfo[k].count} of {per} shots</small></>}
            <div className="shot-nav"><button type="button" className="secondary small" disabled={sheet === 0} onClick={() => setSheet(sheet - 1)}>← Prev</button><button type="button" className="secondary small" disabled={sheet === S + n - 1} onClick={() => setSheet(sheet + 1)}>Next →</button></div></div>
        </div>
      </> : <div className="span-2 sheet-grid">
        {totals.map((v, i) => <label key={i}>{tno(i) ? <>Target {tno(i)} <small className="series-tag">Series {i + 1}</small></> : `Sheet ${i + 1}`}<input type="number" step="0.1" min="0" max={perSheetMax} inputMode="decimal" value={v} onChange={(e) => setTotals(totals.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`0–${fmt(perSheetMax)}`} /></label>)}
      </div>}

      <div className="span-2 sheet-total"><span>Match total ({entered.length} of {n} sheets{mode === 'shots' ? ` · ${shotsDone}/${n * per} shots` : ''})</span><b>{anyBad ? '—' : fmt(total)}</b><small>out of {fmt(match.max_score)}</small></div>
      {mode === 'totals' && hasShots && <small className="span-2" style={{ color: '#a4433d' }}>Saving in “Sheet totals only” removes this shooter’s shot-by-shot details.</small>}
      <label>Inner tens (tie-breaker)<input type="number" step="1" min="0" value={inner} onChange={(e) => setInner(e.target.value)} /></label>
      <label>Note (optional)<input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Qualified for final" /></label>
      {error && <p className="error span-2" style={{ color: '#a4433d', fontSize: 12, margin: 0 }}>{error}</p>}
      <div className="modal-actions span-2"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save score'}</button></div>
    </form>
  </div></div>;
}

export const ALL_LANES = Array.from({ length: 10 }, (_, i) => i + 1);
const maxFor = (sheets, per, fallback) => (Number(sheets) > 0 && Number(per) > 0 ? String(Math.round(Number(sheets) * Number(per) * 10.9 * 10) / 10) : fallback);

function MatchModal({ match, onClose, onDone }) {
  const [form, setForm] = useState({
    name: match?.name || '', discipline: match?.discipline || '10m Air Rifle', match_date: match?.match_date || todayStr(),
    venue: match?.venue || 'AADI Rifle Shooting Academy, Yelahanka', description: match?.description || '',
    sheets: String(match?.sheets ?? 6), shots_per_sheet: String(match?.shots_per_sheet ?? 10), max_score: String(Number(match?.max_score ?? 654)), relays: String(match?.relays ?? 1), sighting_sheets: String(match?.sighting_sheets ?? 2),
    format: match?.format || 'individual', team_size: String(match?.team_size ?? 2),
  });
  const [lanes, setLanes] = useState(() => match?.lanes?.length ? match.lanes : ALL_LANES);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault(); setError('');
    if (!form.name.trim()) { setError('Give the match a name.'); return; }
    if (!(Number(form.sheets) > 0) || !(Number(form.shots_per_sheet) > 0) || !(Number(form.max_score) > 0)) { setError('Sheets, shots per sheet and maximum score must be greater than 0.'); return; }
    if (lanes.length === 0) { setError('Select at least one lane for this match.'); return; }
    setBusy(true);
    const row = { name: form.name.trim(), discipline: form.discipline, match_date: form.match_date, venue: form.venue.trim() || null, description: form.description.trim() || null, sheets: Number(form.sheets), shots_per_sheet: Number(form.shots_per_sheet), shots: Number(form.sheets) * Number(form.shots_per_sheet), max_score: Number(form.max_score), format: form.format, team_size: Math.min(10, Math.max(2, parseInt(form.team_size, 10) || 2)), relays: Math.max(1, Number(form.relays) || 1), sighting_sheets: Math.min(5, Math.max(0, parseInt(form.sighting_sheets, 10) || 0)), lanes: [...lanes].sort((a, b) => a - b) };
    const { error } = match ? await supabase.from('matches').update(row).eq('id', match.id) : await supabase.from('matches').insert(row);
    setBusy(false);
    if (error) setError(error.message); else onDone(match ? 'Match updated.' : 'Match created. Shooters have been notified and can register now.');
  }

  return <div className="modal-backdrop"><div className="modal">
    <div className="modal-head"><div><h2>{match ? 'Edit match' : 'Organise a match'}</h2><p className="muted">{match ? 'Update the match details.' : 'Shooters are notified and can register as soon as you save.'}</p></div><button className="icon-btn" onClick={onClose}><X /></button></div>
    <form onSubmit={submit} className="form-grid">
      <label className="span-2">Match name *<input required value={form.name} onChange={set('name')} placeholder="e.g. Academy Open 2026" /></label>
      <label>Date<input type="date" required value={form.match_date} onChange={set('match_date')} /></label>
      <label>Discipline<select value={form.discipline} onChange={set('discipline')}><option>10m Air Rifle</option><option>10m Air Pistol</option><option>50m Rifle</option><option>Other</option></select></label>
      <label className="span-2">Venue<input value={form.venue} onChange={set('venue')} /></label>
      <label>Number of sheets<input type="number" min="1" max="12" required value={form.sheets} onChange={(e) => setForm({ ...form, sheets: e.target.value, max_score: maxFor(e.target.value, form.shots_per_sheet, form.max_score) })} /></label>
      <label>Shots per sheet<input type="number" min="1" required value={form.shots_per_sheet} onChange={(e) => setForm({ ...form, shots_per_sheet: e.target.value, max_score: maxFor(form.sheets, e.target.value, form.max_score) })} /></label>
      <label className="span-2">Maximum score (10.9 per shot)<input type="number" min="1" step="0.1" required value={form.max_score} onChange={set('max_score')} />
        <small style={{ color: '#8792a4' }}>{Number(form.sheets) * Number(form.shots_per_sheet) || 0} shots in total. Admin enters one score per sheet; the total is calculated automatically.</small></label>
      <div className="span-2 format-picker"><b>Match type</b>
        <div className="format-cards">
          <button type="button" className={form.format === 'individual' ? 'on' : ''} aria-pressed={form.format === 'individual'} onClick={() => setForm({ ...form, format: 'individual' })}><Users size={18} /><span><b>Single player</b><small>Each shooter competes on their own score.</small></span></button>
          <button type="button" className={form.format === 'team' ? 'on' : ''} aria-pressed={form.format === 'team'} onClick={() => setForm({ ...form, format: 'team' })}><Users size={18} /><span><b>Team match</b><small>Admin forms the teams. Team score = sum of its players.</small></span></button>
        </div>
        {form.format === 'team' && <label className="team-size">Players per team<input type="number" min="2" max="10" value={form.team_size} onChange={set('team_size')} /><small>Individual scores are still ranked as well.</small></label>}
      </div>
      <div className="span-2 lane-picker"><span className="lane-picker-head"><b>Lanes used for this match</b><small>{lanes.length} of {ALL_LANES.length} selected</small>
        <button type="button" className="link-button" onClick={() => setLanes(lanes.length === ALL_LANES.length ? [] : ALL_LANES)}>{lanes.length === ALL_LANES.length ? 'Clear all' : 'Select all'}</button></span>
        <div className="lane-chips">{ALL_LANES.map((n) => <button type="button" key={n} className={`lane-chip ${lanes.includes(n) ? 'on' : ''}`} aria-pressed={lanes.includes(n)} onClick={() => setLanes(lanes.includes(n) ? lanes.filter((x) => x !== n) : [...lanes, n])}>{n}</button>)}</div></div>
      <label>Sighting sheets (not scored)<input type="number" min="0" max="5" value={form.sighting_sheets} onChange={set('sighting_sheets')} /><small style={{ color: '#8792a4' }}>Given first to set up the weapon. They never count in the total or the ranking.</small></label>
      <label>Number of relays<input type="number" min="1" max="20" required value={form.relays} onChange={set('relays')} /><small style={{ color: '#8792a4' }}>Use more than 1 when shooters outnumber lanes — each relay shoots in turn.</small></label>
      <div className="lane-summary"><small>Per relay</small><b>{lanes.length} shooters</b><small>{Number(form.sighting_sheets) || 0} sighting + {Number(form.sheets) || 0} scored series × {Number(form.shots_per_sheet) || 0} shots</small></div>
      <label className="span-2">Details (optional)<input value={form.description} onChange={set('description')} placeholder="Reporting time, rules, entry notes…" /></label>
      {error && <p className="error span-2" style={{ color: '#a4433d', fontSize: 12, margin: 0 }}>{error}</p>}
      <div className="modal-actions span-2"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Saving…' : match ? 'Save changes' : 'Create match'}</button></div>
    </form>
  </div></div>;
}

// ---- Lane plan: admin decides lanes, relays, shooters and target-sheet numbers ----------------------
function LanePlan({ match, regs, shooters, teams = [], onChanged, setError, setNotice }) {
  const lanes = (match.lanes && match.lanes.length ? match.lanes : ALL_LANES).slice().sort((a, b) => a - b);
  const series = match.sheets || 1;
  const sight = match.sighting_sheets || 0;
  const issued = sight + series; // every physical target sheet handed out
  const sheetLabel = (i) => (i < sight ? `Sight ${i + 1}` : `S${i - sight + 1}`);
  const relayCount = match.relays || 1;
  const [relay, setRelay] = useState(1);
  const [busy, setBusy] = useState(false);
  const [startNo, setStartNo] = useState('1');
  const nameOf = (r) => r.shooters?.full_name || 'Shooter';
  const inRelay = regs.filter((r) => r.lane_no && (r.relay || 1) === relay);
  const byLane = new Map(inRelay.map((r) => [String(r.lane_no), r]));
  const unassigned = regs.filter((r) => !r.lane_no);
  const assignedCount = regs.filter((r) => r.lane_no).length;
  const totalShots = series * (match.shots_per_sheet || 0);

  async function run(fn, okText) {
    setBusy(true); setError('');
    const res = await fn();
    setBusy(false);
    if (res?.error) setError(res.error.message); else { if (okText) setNotice(okText); onChanged(); }
  }
  const patchReg = (id, patch) => supabase.from('match_registrations').update(patch).eq('id', id);
  const assign = (lane, regId) => run(() => patchReg(regId, { lane_no: String(lane), relay }));
  const unassign = (r) => run(() => patchReg(r.id, { lane_no: null, sheet_targets: null }));
  async function saveTargets(r, idx, value) {
    const arr = Array.from({ length: issued }, (_, i) => (r.sheet_targets && r.sheet_targets[i]) || '');
    if (arr[idx] === value.trim()) return;
    arr[idx] = value.trim();
    await run(() => patchReg(r.id, { sheet_targets: arr.some(Boolean) ? arr : null }));
  }
  async function autoAssign() {
    const start = Math.max(1, parseInt(startNo, 10) || 1);
    const pending = unassigned.slice().sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    if (!pending.length) { setNotice('Every registered shooter already has a lane.'); return; }
    // fill relay by relay, lane by lane, using only free lanes
    const plan = [];
    let queue = [...pending];
    for (let rl = 1; rl <= relayCount && queue.length; rl++) {
      const taken = new Set(regs.filter((r) => r.lane_no && (r.relay || 1) === rl).map((r) => String(r.lane_no)));
      for (const ln of lanes) { if (!queue.length) break; if (!taken.has(String(ln))) plan.push({ r: queue.shift(), ln, rl }); }
    }
    if (queue.length) setError(`${queue.length} shooter(s) did not fit — add another relay or more lanes in “Edit match”.`);
    await run(async () => {
      let next = start;
      for (const { r, ln, rl } of plan) {
        const targets = Array.from({ length: issued }, () => String(next++));
        const { error } = await patchReg(r.id, { lane_no: String(ln), relay: rl, sheet_targets: targets });
        if (error) return { error };
      }
      return {};
    }, `${plan.length} shooter(s) assigned lanes and target sheets.`);
  }
  async function numberTargets() {
    const start = Math.max(1, parseInt(startNo, 10) || 1);
    const rows = regs.filter((r) => r.lane_no).sort((a, b) => (a.relay || 1) - (b.relay || 1) || Number(a.lane_no) - Number(b.lane_no));
    await run(async () => {
      let next = start;
      for (const r of rows) { const { error } = await patchReg(r.id, { sheet_targets: Array.from({ length: issued }, () => String(next++)) }); if (error) return { error }; }
      return {};
    }, `Target sheets numbered from ${start} (${rows.length * issued} sheets).`);
  }
  // Shooters whose target-sheet numbers do not cover every sheet issued (e.g. sheets were added after numbering).
  const filled = (r) => Array.from({ length: issued }, (_, i) => (r.sheet_targets && r.sheet_targets[i]) || '').filter(Boolean).length;
  const incomplete = regs.filter((r) => r.lane_no && filled(r) < issued);
  async function fillMissing() {
    const all = regs.flatMap((r) => r.sheet_targets || []).map((t) => parseInt(t, 10)).filter(Number.isFinite);
    let next = all.length ? Math.max(...all) : Math.max(0, (parseInt(startNo, 10) || 1) - 1);
    const rows = incomplete.slice().sort((a, b) => (a.relay || 1) - (b.relay || 1) || Number(a.lane_no) - Number(b.lane_no));
    await run(async () => {
      for (const r of rows) {
        const arr = Array.from({ length: issued }, (_, i) => (r.sheet_targets && r.sheet_targets[i]) || '').map((t) => t || String(++next));
        const { error } = await patchReg(r.id, { sheet_targets: arr });
        if (error) return { error };
      }
      return {};
    }, `Missing target numbers added for ${rows.length} shooter(s).`);
  }
  async function clearRelay() {
    if (!inRelay.length || !window.confirm(`Clear all lane assignments in Relay ${relay}?`)) return;
    await run(async () => { for (const r of inRelay) { const { error } = await patchReg(r.id, { lane_no: null, sheet_targets: null }); if (error) return { error }; } return {}; }, `Relay ${relay} cleared.`);
  }
  async function setRelays(n) {
    if (n < 1 || n > 20) return;
    if (n < relayCount && regs.some((r) => r.lane_no && (r.relay || 1) > n)) { setError('Clear the lanes of the last relay before removing it.'); return; }
    const { error } = await supabase.from('matches').update({ relays: n }).eq('id', match.id);
    if (error) setError(error.message); else { if (relay > n) setRelay(n); onChanged(); }
  }
  async function togglePublish() {
    if (!match.lanes_published && assignedCount === 0) { setError('Assign at least one shooter to a lane first.'); return; }
    await run(() => supabase.from('matches').update({ lanes_published: !match.lanes_published }).eq('id', match.id),
      match.lanes_published ? 'Lane plan hidden from shooters.' : 'Lane plan published — shooters have been notified.');
  }
  function printPlan() {
    const assigned = regs.filter((r) => r.lane_no);
    if (!assigned.length) return;
    const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const isTeam = match.format === 'team';
    const teamOf = (r) => teams.find((t) => t.id === r.team_id)?.name || '';
    const byLaneRelay = (rl) => assigned.filter((r) => (r.relay || 1) === rl).sort((a, b) => Number(a.lane_no) - Number(b.lane_no));
    const heads = Array.from({ length: issued }, (_, i) => i < sight
      ? `<th class="sg">Sighting ${i + 1}<small>not scored</small></th>`
      : `<th>Series ${i - sight + 1}<small>${match.shots_per_sheet} shots</small></th>`).join('');
    const sections = Array.from({ length: relayCount }, (_, k) => k + 1).map((rl, idx) => {
      const rows = byLaneRelay(rl);
      if (!rows.length) return '';
      const strip = lanes.map((ln) => { const r = rows.find((x) => String(x.lane_no) === String(ln)); return `<div class="ln ${r ? 'on' : ''}"><span>${ln}</span><b>${r ? esc(r.shooters?.full_name) : 'Empty'}</b></div>`; }).join('');
      const body = rows.map((r) => `<tr><td class="lane">${esc(r.lane_no)}</td><td class="l"><b>${esc(r.shooters?.full_name)}</b>${r.shooters?.is_guest ? ' <i>Guest</i>' : ''}<br><small>${esc(r.shooters?.shooter_code)}</small></td>${isTeam ? `<td class="l">${esc(teamOf(r) || '—')}</td>` : ''}${Array.from({ length: issued }, (_, i) => `<td class="${i < sight ? 'sg' : ''}">${esc(r.sheet_targets?.[i] || '')}</td>`).join('')}<td class="sign"></td></tr>`).join('');
      return `<section class="relay ${idx > 0 ? 'brk' : ''}">
        <div class="relay-head"><h2>${relayCount > 1 ? `Relay ${rl}` : 'Lane allocation'}</h2><span>${rows.length} shooter${rows.length > 1 ? 's' : ''}</span><span class="fill">Reporting time: ________ &nbsp; Start time: ________</span></div>
        <div class="strip">${strip}</div>
        <table><thead><tr><th>Lane</th><th class="l">Shooter</th>${isTeam ? '<th class="l">Team</th>' : ''}${heads}<th class="sign">Sign</th></tr></thead><tbody>${body}</tbody></table>
      </section>`;
    }).join('');
    const missing = regs.filter((r) => !r.lane_no);
    const landscape = issued > 7 || (isTeam && issued > 5);
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(match.name)} – Lane plan</title><style>
@page{size:A4 ${landscape ? 'landscape' : 'portrait'};margin:13mm}
*{box-sizing:border-box}body{font:12px/1.45 "Segoe UI",Arial,sans-serif;color:#172238;margin:0}
.bar{position:sticky;top:0;background:#0b2850;color:#fff;padding:8px 14px;display:flex;gap:10px;align-items:center;font-size:13px}.bar button{background:#f2ae09;border:0;border-radius:8px;padding:7px 14px;font-weight:700;cursor:pointer}@media print{.bar{display:none}}
.head{display:flex;align-items:center;gap:14px;border-bottom:3px solid #f2ae09;padding-bottom:10px}.head img{height:54px}.head .t{flex:1}.head h1{margin:0;font-size:20px;color:#0b2850;letter-spacing:.02em}.head p{margin:2px 0 0;color:#5a6a82}
.stamp{padding:4px 10px;border-radius:999px;font-weight:700;font-size:11px;letter-spacing:.06em;text-transform:uppercase;background:#e5f6ec;color:#1f7a45}.stamp.draft{background:#fff1cf;color:#8a6a1f}
.title{margin:16px 0 2px;font-size:22px;color:#0b2850}.sub{color:#5a6a82;margin:0 0 12px}
.facts{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:10px 0 6px}.facts div{border:1px solid #dfe6f1;border-radius:8px;padding:7px 10px;background:#f7f9fd}.facts small{display:block;color:#8792a4;font-size:9.5px;letter-spacing:.1em;text-transform:uppercase}.facts b{font-size:13px}
.note{margin:8px 0;color:#48556a}.relay{margin-top:14px}.relay.brk{page-break-before:always}
.relay-head{display:flex;align-items:baseline;gap:12px;border-left:4px solid #f2ae09;padding-left:8px;margin-bottom:8px}.relay-head h2{margin:0;font-size:15px;color:#0b2850}.relay-head span{color:#66748b}.relay-head .fill{margin-left:auto;color:#48556a}
.strip{display:grid;grid-template-columns:repeat(${Math.min(lanes.length, 10)},1fr);gap:4px;margin-bottom:10px}.ln{border:1px dashed #cfd8e6;border-radius:7px;padding:4px 3px;text-align:center;min-width:0}.ln span{display:block;font-weight:800;font-size:14px;color:#a1aabb}.ln b{display:block;font-size:9px;font-weight:600;color:#a1aabb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ln.on{border:1px solid #0b2850;background:#f1f7ff}.ln.on span{color:#0b2850}.ln.on b{color:#172238}
table{width:100%;border-collapse:collapse}th,td{border:1px solid #cfd8e6;padding:6px;text-align:center;vertical-align:middle}th{background:#0b2850;color:#fff;font-size:11px}th small{display:block;font-weight:400;opacity:.8;font-size:9px}td.l,th.l{text-align:left}td.lane{font-weight:800;font-size:16px;color:#0b2850;width:50px}td.sign,th.sign{width:92px}tr{page-break-inside:avoid;height:34px}
th.sg{background:#5b6b86}td.sg{background:#f4f5f8;color:#66748b}small{color:#66748b}i{color:#8a6a1f;font-style:normal;font-weight:700;font-size:10px}
.sign-row{display:grid;grid-template-columns:repeat(3,1fr);gap:28px;margin-top:40px;page-break-inside:avoid}.sign-row div{border-top:1px solid #172238;padding-top:5px;text-align:center;font-size:11px;color:#48556a}
.foot{margin-top:16px;padding-top:6px;border-top:1px solid #dfe6f1;display:flex;justify-content:space-between;color:#8792a4;font-size:10px}
</style></head><body>
<div class="bar"><span>Print-ready lane sheet</span><button onclick="window.print()">Print / Save as PDF</button></div>
<div style="padding:14px 18px">
<div class="head"><img src="${location.origin}/aadi-logo.png" alt="AADI" onerror="this.style.display='none'"><div class="t"><h1>AADI RIFLE SHOOTING ACADEMY</h1><p>${esc(match.venue || 'Yelahanka, Bengaluru')}</p></div><span class="stamp ${match.lanes_published ? '' : 'draft'}">${match.lanes_published ? 'Lane plan' : 'Draft lane plan'}</span></div>
<h1 class="title">${esc(match.name)}</h1><p class="sub">${esc(fmtDay(match.match_date))} · ${esc(match.discipline)} · ${isTeam ? `Team match (${match.team_size} per team)` : 'Single-player match'}</p>
<div class="facts"><div><small>Lanes in use</small><b>${lanes.join(', ')}</b></div><div><small>Relays</small><b>${relayCount}</b></div><div><small>Course of fire</small><b>${series} series × ${match.shots_per_sheet} shots</b></div><div><small>Shooters placed</small><b>${assigned.length} of ${regs.length}</b></div></div>
${sight > 0 ? `<p class="note"><b>Sighting sheets:</b> the first ${sight} target sheet${sight > 1 ? 's are' : ' is'} for weapon set-up and ${sight > 1 ? 'do' : 'does'} not count towards the score.</p>` : ''}
${sections}
${missing.length ? `<p class="note"><b>Registered but not yet placed on a lane:</b> ${missing.map((r) => esc(r.shooters?.full_name)).join(', ')}.</p>` : ''}
<div class="sign-row"><div>Range Officer</div><div>Match Director</div><div>Chief Coach</div></div>
<div class="foot"><span>${esc(match.name)} · ${esc(fmtDay(match.match_date))}</span><span>Printed ${esc(new Date().toLocaleString('en-IN'))}</span></div>
</div></body></html>`;
    const w = window.open('', '_blank');
    if (!w) { setError('Allow pop-ups to print the lane sheet.'); return; }
    w.document.write(html); w.document.close();
  }

  return <section className="panel lane-plan">
    <div className="panel-heading">
      <div><h2>Lane plan <span className={`badge ${match.lanes_published ? 'green' : 'amber'}`} style={{ verticalAlign: 'middle' }}>{match.lanes_published ? 'Published' : 'Draft'}</span></h2>
        <p className="muted">{lanes.length} lanes · {sight > 0 ? `${sight} sighting (not scored) + ` : ''}{series} scored series × {match.shots_per_sheet} shots = {totalShots} scored shots · {assignedCount}/{regs.length} shooters assigned</p></div>
      <div className="row-actions">
        <button className="secondary" onClick={printPlan} disabled={!assignedCount}><Printer size={15} /> Print</button>
        <button className={match.lanes_published ? 'secondary' : 'primary'} onClick={togglePublish} disabled={busy}>{match.lanes_published ? <><EyeOff size={15} /> Unpublish</> : <><Send size={15} /> Publish to shooters</>}</button>
      </div>
    </div>

    <div className="lane-toolbar">
      <div className="relay-tabs" role="tablist">{Array.from({ length: relayCount }, (_, i) => i + 1).map((n) => <button key={n} role="tab" aria-selected={relay === n} className={relay === n ? 'on' : ''} onClick={() => setRelay(n)}>Relay {n}<small>{regs.filter((r) => r.lane_no && (r.relay || 1) === n).length}/{lanes.length}</small></button>)}
        <button className="relay-step" title="Add relay" onClick={() => setRelays(relayCount + 1)}><Plus size={14} /></button>
        {relayCount > 1 && <button className="relay-step" title="Remove last relay" onClick={() => setRelays(relayCount - 1)}><Minus size={14} /></button>}</div>
      <div className="lane-auto"><label>First target no.<input type="number" min="1" value={startNo} onChange={(e) => setStartNo(e.target.value)} /></label>
        <button className="secondary" onClick={autoAssign} disabled={busy || !unassigned.length}><Wand2 size={14} /> Auto-assign {unassigned.length || ''}</button>
        <button className="secondary" onClick={numberTargets} disabled={busy || !assignedCount} title="Re-number all target sheets in lane order">Number targets</button>
        <button className="small-outline no" onClick={clearRelay} disabled={busy || !inRelay.length}>Clear relay</button></div>
    </div>

    {incomplete.length > 0 && <div className="alert error lane-warn"><span><b>Target numbers incomplete.</b> {incomplete.length} shooter(s) have fewer than {issued} target sheet numbers ({sight} sighting + {series} scored){incomplete.length <= 4 ? `: ${incomplete.map(nameOf).join(', ')}` : ''}. This usually happens when sheets were added after numbering.</span>
      <button className="secondary small" onClick={fillMissing} disabled={busy}>Fill missing numbers</button></div>}

    {regs.length === 0 ? <div className="empty-inline"><Users /><p>No registered shooters yet.</p><span>Once shooters register you can place them on lanes here.</span></div> :
      <div className="lane-grid">{lanes.map((ln) => {
        const r = byLane.get(String(ln));
        return <div key={ln} className={`lane-card ${r ? 'filled' : ''}`}>
          <div className="lane-no"><span>Lane</span><b>{ln}</b></div>
          {r ? <>
            <div className="lane-who"><b>{nameOf(r)}</b><small>{r.shooters?.shooter_code}</small><button className="icon-btn lane-x" title="Free this lane" onClick={() => unassign(r)} disabled={busy}><X size={14} /></button></div>
            <div className="lane-targets"><small>Target sheet no. · {match.shots_per_sheet} shots each</small>
              <div>{Array.from({ length: issued }, (_, i) => <label key={`${r.id}-${i}-${r.sheet_targets?.[i] || ''}`} className={i < sight ? 'sighting' : ''}><span>{sheetLabel(i)}</span><input defaultValue={r.sheet_targets?.[i] || ''} placeholder="No." inputMode="numeric" onBlur={(e) => saveTargets(r, i, e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} /></label>)}</div></div>
          </> : <select className="lane-pick" value="" disabled={busy || !unassigned.length} onChange={(e) => e.target.value && assign(ln, e.target.value)}>
            <option value="">{unassigned.length ? '+ Assign shooter' : 'No shooters left'}</option>
            {unassigned.map((u) => <option key={u.id} value={u.id}>{nameOf(u)} ({u.shooters?.shooter_code})</option>)}</select>}
        </div>;
      })}</div>}
    {regs.length > 0 && unassigned.length > 0 && <p className="muted lane-note">{unassigned.length} registered shooter(s) still need a lane: {unassigned.map(nameOf).join(', ')}.</p>}
  </section>;
}


// ---- Teams (team matches): admin forms teams and places players ------------------------------------
function TeamsPanel({ match, regs, teams, board, onChanged, setError, setNotice }) {
  const size = match.team_size || 2;
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const unassigned = regs.filter((r) => !r.team_id).sort((a, b) => String(a.registered_at).localeCompare(String(b.registered_at)));
  const scoreOf = (regId) => board.find((b) => b.reg_id === regId);
  const cards = teams.map((t) => {
    const members = regs.filter((r) => r.team_id === t.id);
    const sc = members.map((m) => scoreOf(m.id)).filter((b) => b && b.score !== null);
    return { ...t, members, scored: sc.length, total: Math.round(sc.reduce((a, b) => a + b.score, 0) * 10) / 10, inner: sc.reduce((a, b) => a + (b.inner_tens || 0), 0) };
  });
  const ranked = cards.filter((c) => c.scored > 0).sort((a, b) => b.total - a.total || b.inner - a.inner);
  let place = 0; ranked.forEach((c, i) => { if (i === 0 || c.total !== ranked[i - 1].total || c.inner !== ranked[i - 1].inner) place = i + 1; c.rank = place; });
  const ordered = [...ranked, ...cards.filter((c) => c.scored === 0)];
  const nameOf = (r) => r.shooters?.full_name || 'Shooter';

  async function run(fn, ok) { setBusy(true); setError(''); const { error } = (await fn()) || {}; setBusy(false); if (error) setError(error.message); else { if (ok) setNotice(ok); onChanged(); } }
  const nextName = (used) => { let n = used.length + 1; while (used.some((u) => u.toLowerCase() === `team ${n}`)) n++; return `Team ${n}`; };
  const addTeam = () => run(() => supabase.from('match_teams').insert({ match_id: match.id, name: name.trim() || nextName(teams.map((t) => t.name)) }), 'Team created.').then(() => setName(''));
  const rename = (t) => { const v = window.prompt('Team name', t.name); if (v && v.trim() && v.trim() !== t.name) run(() => supabase.from('match_teams').update({ name: v.trim() }).eq('id', t.id), 'Team renamed.'); };
  const del = (t) => window.confirm(`Delete “${t.name}”? Its players stay registered but become unassigned.`) && run(() => supabase.from('match_teams').delete().eq('id', t.id), 'Team deleted.');
  const assign = (regId, teamId) => run(() => supabase.from('match_registrations').update({ team_id: teamId }).eq('id', regId));
  async function autoForm() {
    if (!unassigned.length) return;
    await run(async () => {
      const queue = [...unassigned], used = teams.map((t) => t.name);
      for (const c of cards) { while (c.members.length < size && queue.length) { const r = queue.shift(); const { error } = await supabase.from('match_registrations').update({ team_id: c.id }).eq('id', r.id); if (error) return { error }; c.members.push(r); } }
      while (queue.length) {
        const nm = nextName(used); used.push(nm);
        const { data, error } = await supabase.from('match_teams').insert({ match_id: match.id, name: nm }).select('id').single();
        if (error) return { error };
        for (const r of queue.splice(0, size)) { const { error: e2 } = await supabase.from('match_registrations').update({ team_id: data.id }).eq('id', r.id); if (e2) return { error: e2 }; }
      }
      return {};
    }, 'Teams formed from the unassigned players.');
  }

  return <section className="panel teams-panel">
    <div className="panel-heading"><div><h2>Teams</h2><p className="muted">{teams.length} team{teams.length === 1 ? '' : 's'} · {size} players each · only you can form or change teams · team score = total of its players’ scores.</p></div>
      <div className="row-actions"><input className="team-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Team name (optional)" maxLength={40} onKeyDown={(e) => e.key === 'Enter' && addTeam()} />
        <button className="primary" disabled={busy} onClick={addTeam}><Plus size={15} /> New team</button>
        <button className="secondary" disabled={busy || !unassigned.length} onClick={autoForm} title="Fill open slots and create new teams from the unassigned players"><Wand2 size={14} /> Auto-form teams</button></div></div>
    {unassigned.length > 0 && <p className="muted team-note"><b>{unassigned.length} player(s) not in a team:</b> {unassigned.map((r) => `${nameOf(r)}${r.shooters?.is_guest ? ' (guest)' : ''}`).join(', ')}.</p>}
    {teams.length === 0 ? <div className="empty-inline"><Users /><p>No teams yet.</p><span>Create a team, then add players to it — or let “Auto-form teams” split everyone for you.</span></div> :
      <div className="team-grid">{ordered.map((t) => <div key={t.id} className="team-card">
        <div className="team-head">
          {t.rank ? <span className={`rank-chip r${Math.min(t.rank, 4)}`}>{t.rank}</span> : <span className="team-dot"><Users size={14} /></span>}
          <div className="team-title"><b>{t.name}</b><small>{t.members.length}/{size} players{t.scored ? ` · ${t.scored} scored` : ''}</small></div>
          <div className="team-total"><b>{t.scored ? fmt(t.total) : '—'}</b><small>/ {fmt(Number(match.max_score) * size)}</small></div>
        </div>
        <ul className="team-members">{t.members.map((r) => { const sc = scoreOf(r.id); return <li key={r.id}><span>{nameOf(r)}{r.shooters?.is_guest && <span className="guest-tag">Guest</span>}</span><em>{sc && sc.score !== null ? fmt(sc.score) : '—'}</em>
          <button className="icon-btn" title="Remove from team" disabled={busy} onClick={() => assign(r.id, null)}><X size={14} /></button></li>; })}
          {Array.from({ length: Math.max(0, size - t.members.length) }, (_, i) => <li key={`e${i}`} className="empty-slot">Open slot</li>)}</ul>
        <div className="team-foot">
          <select value="" disabled={busy || t.members.length >= size || !unassigned.length} onChange={(e) => e.target.value && assign(e.target.value, t.id)}>
            <option value="">{t.members.length >= size ? 'Team is full' : unassigned.length ? '+ Add player' : 'No unassigned players'}</option>
            {unassigned.map((r) => <option key={r.id} value={r.id}>{nameOf(r)}{r.shooters?.is_guest ? ' (guest)' : ''}</option>)}</select>
          <button className="icon-btn" title="Rename team" onClick={() => rename(t)}><Pencil size={14} /></button>
          <button className="icon-btn" title="Delete team" onClick={() => del(t)}><Trash2 size={14} /></button>
        </div>
      </div>)}</div>}
  </section>;
}

// ---- On-the-spot guest registration ----------------------------------------------------------------
function GuestModal({ match, teams, regs, onClose, onAdded }) {
  const empty = { full_name: '', phone: '', club: '', dob: '', team_id: '' };
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [added, setAdded] = useState([]); // guests registered in this sitting
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const isTeam = match.format === 'team';
  const size = match.team_size || 2;
  const open = teams.filter((t) => regs.filter((r) => r.team_id === t.id).length < size);

  async function submit(again) {
    setError('');
    if (!form.full_name.trim()) { setError('Enter the guest’s name.'); return; }
    if (form.phone.trim() && form.phone.replace(/\D/g, '').length < 7) { setError('Enter a valid phone number, or leave it empty.'); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc('register_guest_for_match', {
      p_match_id: match.id, p_name: form.full_name.trim(), p_phone: form.phone.trim() || null, p_club: form.club.trim() || null,
      p_dob: form.dob || null, p_team_id: form.team_id || null });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setAdded((a) => [{ name: form.full_name.trim(), code: data.code, reused: data.reused }, ...a]);
    onAdded();
    if (again) setForm(empty); else onClose();
  }

  return <div className="modal-backdrop"><div className="modal">
    <div className="modal-head"><div><h2>Register a guest</h2><p className="muted">On-the-spot entry for {match.name}. No membership or sign-in needed.</p></div><button className="icon-btn" onClick={onClose}><X /></button></div>
    {added.length > 0 && <div className="alert success guest-added"><b>{added.length} guest{added.length > 1 ? 's' : ''} registered:</b> {added.slice(0, 4).map((g) => `${g.name} (${g.code}${g.reused ? ', returning guest' : ''})`).join(' · ')}</div>}
    <form className="form-grid" onSubmit={(e) => { e.preventDefault(); submit(false); }}>
      <label className="span-2">Full name *<input autoFocus required value={form.full_name} onChange={set('full_name')} placeholder="Guest’s full name" /></label>
      <label>Phone<input inputMode="tel" value={form.phone} onChange={set('phone')} placeholder="For results & next time" /></label>
      <label>Club / city (optional)<input value={form.club} onChange={set('club')} placeholder="e.g. Bengaluru" /></label>
      <label>Date of birth (optional)<input type="date" max={todayStr()} value={form.dob} onChange={set('dob')} /></label>
      {isTeam && <label>Team<select value={form.team_id} onChange={set('team_id')}><option value="">Assign later</option>{open.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
      <p className="muted span-2" style={{ fontSize: 12, margin: 0 }}>Guests get a guest ID, appear in the lane plan, scoring and results with a “Guest” tag, and don’t count as academy members or get fees.</p>
      {error && <p className="error span-2" style={{ color: '#a4433d', fontSize: 12, margin: 0 }}>{error}</p>}
      <div className="modal-actions span-2"><button type="button" className="secondary" onClick={onClose}>{added.length ? 'Done' : 'Cancel'}</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => submit(true)}>Register &amp; add next</button>
        <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Register guest'}</button></div>
    </form>
  </div></div>;
}


// ---- Team ranking shared by the admin screen and the results document -------------------------------
function computeTeams(teams, regs, board) {
  const rows = teams.map((t) => {
    const members = regs.filter((r) => r.team_id === t.id).map((r) => board.find((b) => b.reg_id === r.id)).filter(Boolean)
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name));
    const sc = members.filter((m) => m.score !== null);
    return { id: t.id, name: t.name, members, scored: sc.length, total: Math.round(sc.reduce((a, m) => a + m.score, 0) * 10) / 10, inner: sc.reduce((a, m) => a + (m.inner_tens || 0), 0) };
  });
  const ranked = rows.filter((r) => r.scored > 0).sort((a, b) => b.total - a.total || b.inner - a.inner || a.name.localeCompare(b.name));
  let place = 0; ranked.forEach((r, i) => { if (i === 0 || r.total !== ranked[i - 1].total || r.inner !== ranked[i - 1].inner) place = i + 1; r.rank = place; });
  return [...ranked, ...rows.filter((r) => r.scored === 0).map((r) => ({ ...r, rank: null }))];
}

// ---- Official results sheet (print / save as PDF) ---------------------------------------------------
function openResultsDoc(match, board, teamBoard, setError, win) {
  const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const n = match.sheets || 1, per = match.shots_per_sheet || 0, sight = match.sighting_sheets || 0, isTeam = match.format === 'team';
  const scored = board.filter((r) => r.score !== null), waiting = board.filter((r) => r.score === null);
  const final = match.status === 'completed';
  const ord = (r) => { const v = r % 100, sfx = ['th', 'st', 'nd', 'rd']; return r + (sfx[(v - 20) % 10] || sfx[v] || sfx[0]); };
  const sheetHead = Array.from({ length: n }, (_, i) => `<th>S${i + 1}</th>`).join('');
  const podium = (rows, label) => rows.length ? `<div class="pod"><h3>${label}</h3><div class="pod-row">${rows.map((r) => `<div class="pod-card p${r.rank}"><span class="medal">${ord(r.rank)}</span><b>${esc(r.name)}</b><small>${esc(r.sub || '')}</small><em>${fmt(r.score)}</em></div>`).join('')}</div></div>` : '';
  const topInd = scored.filter((r) => r.rank <= 3).slice(0, 3).map((r) => ({ rank: r.rank, name: r.name, score: r.score, sub: r.guest ? 'Guest' : (r.team || '') }));
  const topTeams = teamBoard.filter((t) => t.rank && t.rank <= 3).slice(0, 3).map((t) => ({ rank: t.rank, name: t.name, score: t.total, sub: t.members.map((m) => m.name).join(', ') }));
  const teamTable = isTeam && teamBoard.some((t) => t.scored) ? `<h2>Team results</h2><table><thead><tr><th>Pos</th><th class="l">Team</th><th class="l">Players &amp; scores</th><th>Total</th><th>Inner tens</th></tr></thead><tbody>${teamBoard.filter((t) => t.scored).map((t) => `<tr class="${t.rank <= 3 ? 'top' : ''}"><td><b>${t.rank}</b></td><td class="l"><b>${esc(t.name)}</b></td><td class="l">${t.members.map((m) => `${esc(m.name)}${m.guest ? ' <i>(guest)</i>' : ''} — <b>${m.score === null ? '—' : fmt(m.score)}</b>`).join('<br>')}</td><td><b>${fmt(t.total)}</b></td><td>${t.inner}</td></tr>`).join('')}</tbody></table>` : '';
  const indRows = scored.map((r) => `<tr class="${r.rank <= 3 ? 'top' : ''}"><td><b>${r.rank}</b></td><td class="l"><b>${esc(r.name)}</b>${r.guest ? ' <i>(guest)</i>' : ''}<br><small>${esc(r.guest && r.club ? r.club + ' · ' : '')}${esc(r.code || '')}</small></td>${isTeam ? `<td class="l">${esc(r.team || '—')}</td>` : ''}<td>${r.lane ? esc(r.lane) : '—'}</td>${Array.from({ length: n }, (_, i) => `<td>${r.sheets && r.sheets[i] !== null && r.sheets[i] !== undefined ? fmt(r.sheets[i]) : '·'}</td>`).join('')}<td><b>${fmt(r.score)}</b></td><td>${r.inner_tens}</td></tr>`).join('');
  const dns = waiting.length ? `<p class="note"><b>No score recorded:</b> ${waiting.map((r) => esc(r.name)).join(', ')}.</p>` : '';
  const cols = 4 + (isTeam ? 1 : 0) + n;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(match.name)} – Results</title><style>
@page{size:A4 ${n > 6 || (isTeam && n > 4) ? 'landscape' : 'portrait'};margin:13mm}
*{box-sizing:border-box}body{font:12px/1.45 "Segoe UI",Arial,sans-serif;color:#172238;margin:0}
.head{display:flex;align-items:center;gap:14px;border-bottom:3px solid #f2ae09;padding-bottom:10px}.head img{height:54px}.head .t{flex:1}.head h1{margin:0;font-size:20px;color:#0b2850;letter-spacing:.02em}.head p{margin:2px 0 0;color:#5a6a82}
.stamp{padding:4px 10px;border-radius:999px;font-weight:700;font-size:11px;letter-spacing:.06em;text-transform:uppercase;background:#e5f6ec;color:#1f7a45}.stamp.prov{background:#fff1cf;color:#8a6a1f}
.title{margin:16px 0 4px;font-size:22px;color:#0b2850}.sub{color:#5a6a82;margin:0 0 12px}
.facts{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:10px 0 14px}.facts div{border:1px solid #dfe6f1;border-radius:8px;padding:7px 10px;background:#f7f9fd}.facts small{display:block;color:#8792a4;font-size:9.5px;letter-spacing:.1em;text-transform:uppercase}.facts b{font-size:13px}
.pod{margin:10px 0}.pod h3{margin:0 0 6px;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#8792a4}.pod-row{display:flex;gap:8px}.pod-card{flex:1;border:1px solid #dfe6f1;border-radius:10px;padding:9px 11px;display:flex;flex-direction:column;gap:2px}
.pod-card.p1{background:#fff7e0;border-color:#f0d27a}.pod-card.p2{background:#f3f5f8}.pod-card.p3{background:#fbf1e8;border-color:#e8c9a8}.medal{font-weight:800;color:#b98a2e;font-size:12px}.pod-card b{font-size:14px}.pod-card small{color:#66748b}.pod-card em{font-style:normal;font-weight:800;font-size:18px;color:#0b2850}
h2{margin:18px 0 6px;font-size:14px;color:#0b2850;border-left:4px solid #f2ae09;padding-left:8px}
table{width:100%;border-collapse:collapse;margin-bottom:6px}th,td{border:1px solid #cfd8e6;padding:5px 6px;text-align:center;vertical-align:middle}th{background:#0b2850;color:#fff;font-size:11px}td.l,th.l{text-align:left}tr.top td{background:#fffaf0}tr{page-break-inside:avoid}small{color:#66748b}i{color:#8a6a1f;font-style:normal;font-size:10px}
.note{margin:8px 0;color:#48556a}.sign{display:grid;grid-template-columns:repeat(3,1fr);gap:28px;margin-top:46px;page-break-inside:avoid}.sign div{border-top:1px solid #172238;padding-top:5px;text-align:center;font-size:11px;color:#48556a}
.foot{margin-top:18px;padding-top:6px;border-top:1px solid #dfe6f1;display:flex;justify-content:space-between;color:#8792a4;font-size:10px}
.bar{position:sticky;top:0;background:#0b2850;color:#fff;padding:8px 14px;display:flex;gap:10px;align-items:center;font-size:13px}.bar button{background:#f2ae09;border:0;border-radius:8px;padding:7px 14px;font-weight:700;cursor:pointer}@media print{.bar{display:none}}
</style></head><body>
<div class="bar"><span>Print-ready results sheet</span><button onclick="window.print()">Print / Save as PDF</button></div>
<div style="padding:14px 18px">
<div class="head"><img src="${location.origin}/aadi-logo.png" alt="AADI" onerror="this.style.display='none'"><div class="t"><h1>AADI RIFLE SHOOTING ACADEMY</h1><p>${esc(match.venue || 'Yelahanka, Bengaluru')}</p></div><span class="stamp ${final ? '' : 'prov'}">${final ? 'Official results' : 'Provisional – match not completed'}</span></div>
<h1 class="title">${esc(match.name)}</h1><p class="sub">${esc(fmtDay(match.match_date))} · ${esc(match.discipline)} · ${isTeam ? `Team match (${match.team_size} per team)` : 'Single-player match'}</p>
<div class="facts"><div><small>Course of fire</small><b>${n} series × ${per} shots</b></div><div><small>Scored shots</small><b>${n * per}</b></div><div><small>Maximum score</small><b>${fmt(match.max_score)}</b></div><div><small>Shooters</small><b>${scored.length} scored / ${board.length}</b></div></div>
${sight > 0 ? `<p class="note">${sight} sighting sheet${sight > 1 ? 's were' : ' was'} given for weapon set-up and ${sight > 1 ? 'are' : 'is'} not included in any score.</p>` : ''}
${podium(topTeams, 'Winning teams')}${podium(topInd, isTeam ? 'Top individuals' : 'Podium')}
${teamTable}
<h2>${isTeam ? 'Individual results' : 'Results'}</h2>
<table><thead><tr><th>Pos</th><th class="l">Shooter</th>${isTeam ? '<th class="l">Team</th>' : ''}<th>Lane</th>${sheetHead}<th>Total</th><th>Inner tens</th></tr></thead><tbody>${indRows || `<tr><td colspan="${cols + 1}">No scores recorded.</td></tr>`}</tbody></table>
${dns}
<p class="note"><b>Ranking:</b> by total score, then by number of inner tens.${isTeam ? ' Team score is the sum of all its players’ scores.' : ''} Equal score and inner tens share the same position.</p>
<div class="sign"><div>Range Officer</div><div>Match Director</div><div>Chief Coach</div></div>
<div class="foot"><span>${esc(match.name)} · ${esc(fmtDay(match.match_date))}</span><span>Generated ${esc(new Date().toLocaleString('en-IN'))}</span></div>
</div></body></html>`;
  const w = win || window.open('', '_blank');
  if (!w) { setError('Allow pop-ups to open the results sheet.'); return; }
  w.document.write(html); w.document.close();
}

// ---- Excel / CSV record ------------------------------------------------------------------------------
function downloadResultsCsv(match, board, teamBoard) {
  const q = (v) => { const t = String(v ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const n = match.sheets || 1, isTeam = match.format === 'team';
  const lines = [[match.name], [fmtDay(match.match_date), match.discipline, isTeam ? `Team match (${match.team_size} per team)` : 'Single-player match', `Maximum ${fmt(match.max_score)}`], []];
  if (isTeam && teamBoard.some((t) => t.scored)) {
    lines.push(['TEAM RESULTS'], ['Position', 'Team', 'Players', 'Total', 'Inner tens']);
    teamBoard.filter((t) => t.scored).forEach((t) => lines.push([t.rank, t.name, t.members.map((m) => `${m.name} ${m.score === null ? '-' : fmt(m.score)}`).join('; '), fmt(t.total), t.inner]));
    lines.push([]);
  }
  lines.push([isTeam ? 'INDIVIDUAL RESULTS' : 'RESULTS'], ['Position', 'Name', 'Type', 'ID', ...(isTeam ? ['Team'] : []), 'Lane', ...Array.from({ length: n }, (_, i) => `S${i + 1}`), 'Total', 'Inner tens']);
  board.forEach((r) => lines.push([r.rank ?? '', r.name, r.guest ? 'Guest' : 'Member', r.code || '', ...(isTeam ? [r.team || ''] : []), r.lane || '',
    ...Array.from({ length: n }, (_, i) => (r.sheets && r.sheets[i] !== null && r.sheets[i] !== undefined ? fmt(r.sheets[i]) : '')), r.score === null ? '' : fmt(r.score), r.score === null ? '' : r.inner_tens]));
  const blob = new Blob(['\ufeff' + lines.map((l) => l.map(q).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${match.name.replace(/[^\w]+/g, '-')}-results-${match.match_date}.csv`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}


// Builds the ranked board for any match from raw rows (used by the matches list; MatchDetail builds its own live copy).
function buildBoard(regs, scores, teams) {
  const byShooter = new Map(scores.map((x) => [x.shooter_id, x]));
  return rankRows(regs.map((r) => { const x = byShooter.get(r.shooter_id); return {
    shooter_id: r.shooter_id, reg_id: r.id, name: r.shooters?.full_name || 'Shooter', code: r.shooters?.shooter_code,
    score: x ? Number(x.score) : null, inner_tens: x ? x.inner_tens : 0, existing: x,
    lane: r.lane_no, relay: r.relay || 1, targets: r.sheet_targets || null, sheets: x?.sheet_scores || null,
    guest: !!r.shooters?.is_guest, club: r.shooters?.guest_club, team: teams.find((t) => t.id === r.team_id)?.name || null,
  }; }));
}