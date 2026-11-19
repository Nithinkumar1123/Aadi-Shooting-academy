import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, CheckCircle2, ChevronDown, EyeOff, Info, Lock, MapPin, Search, Target, Trophy, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { fmtDay } from '../lib/format';

const STATUS = { open: ['Registration open', 'live'], closed: ['Registration closed', 'late'], live: ['Match live', 'live'], completed: ['Completed', 'ok'] };
const fmt = (n) => (Math.round(Number(n) * 10) / 10).toFixed(1);
const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const PAGE = 5; // completed matches shown per "Show more"

// Shooter's Matches tab.
//  • Cards are collapsed by default (one clean summary line each) so the list stays short even after many matches.
//  • A card opens to show the shooter's own position / sheets (if they took part) and the published standings.
//  • Published results are visible to every shooter – including new members or anyone who did not register.
export default function MemberMatches({ shooter, focusMatch = null }) {
  const [matches, setMatches] = useState([]);
  const [regIds, setRegIds] = useState(new Set());
  const [counts, setCounts] = useState({});
  const [positions, setPositions] = useState({}); // matchId -> my_match_position
  const [results, setResults] = useState({});     // matchId -> match_full_results (when published)
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());
  const [filter, setFilter] = useState(null); // 'upcoming' | 'completed' | 'all' (chosen after first load)
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const expandedRef = useRef(expanded); expandedRef.current = expanded;
  const positionsRef = useRef(positions); positionsRef.current = positions;
  const [focusId, setFocusId] = useState(null); // card briefly highlighted after opening it from a notification
  const handledFocus = useRef(null);
  const firstLoad = useRef(true);

  const loadPositions = useCallback(async (ids) => {
    const got = await Promise.all(ids.map(async (id) => [id, (await supabase.rpc('my_match_position', { p_match_id: id })).data]));
    setPositions((old) => {
      const next = { ...old };
      got.forEach(([id, data]) => {
        if (!data) return;
        const was = old[id], changed = was && (was.rank !== data.rank || was.score !== data.score);
        next[id] = data;
        if (changed) { setFlash(id); setTimeout(() => setFlash((f) => (f === id ? null : f)), 2500); }
      });
      return next;
    });
  }, []);

  const loadResults = useCallback(async (ids) => {
    if (!ids.length) return;
    const got = await Promise.all(ids.map(async (id) => [id, (await supabase.rpc('match_full_results', { p_match_id: id })).data]));
    setResults((old) => { const next = { ...old }; got.forEach(([id, d]) => { if (d?.available) next[id] = d; else delete next[id]; }); return next; });
  }, []);

  const load = useCallback(async () => {
    const [m, r] = await Promise.all([
      supabase.from('matches').select('*').order('match_date', { ascending: false }),
      supabase.from('match_registrations').select('match_id').eq('shooter_id', shooter.id),
    ]);
    if (m.error || r.error) { setError((m.error || r.error).message + ' (Has migration 015 been applied?)'); setLoading(false); return; }
    setError('');
    const list = m.data || [], regs = new Set((r.data || []).map((x) => x.match_id));
    setMatches(list); setRegIds(regs);

    // Registration counts for EVERY match (a completed match must not show "0 registered" to non-participants).
    const all = await supabase.rpc('match_registration_counts');
    if (!all.error && all.data) setCounts(all.data);
    else {
      const c = {};
      await Promise.all(list.map(async (x) => { c[x.id] = (await supabase.rpc('match_registration_count', { p_match_id: x.id })).data || 0; }));
      setCounts(c);
    }

    // Keep requests light: live/upcoming matches + anything open on screen refresh every time; finished matches load once.
    const open = expandedRef.current;
    const posIds = list.filter((x) => regs.has(x.id) && (x.status !== 'completed' || open.has(x.id) || !positionsRef.current[x.id])).map((x) => x.id);
    const resIds = list.filter((x) => x.status === 'completed' && x.results_published && open.has(x.id)).map((x) => x.id);
    await Promise.all([loadPositions(posIds), loadResults(resIds)]);

    if (firstLoad.current) {
      firstLoad.current = false;
      const upcoming = list.filter((x) => x.status === 'open' || x.status === 'closed');
      setFilter(upcoming.length ? 'upcoming' : 'completed');
      const auto = new Set(list.filter((x) => regs.has(x.id) && x.status === 'live').map((x) => x.id)); // live match you're in: show it open
      if (auto.size) setExpanded(auto);
    }
    setLoading(false);
  }, [shooter.id, loadPositions, loadResults]);

  useEffect(() => {
    load();
    const ch = supabase.channel(`aadi-member-matches-${shooter.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_registrations', filter: `shooter_id=eq.${shooter.id}` }, load)
      .subscribe();
    const poll = window.setInterval(load, 20000); // safety net if realtime is unavailable
    return () => { window.clearInterval(poll); supabase.removeChannel(ch); };
  }, [load, shooter.id]);

  function toggle(m) {
    const opening = !expanded.has(m.id);
    setExpanded((o) => { const n = new Set(o); opening ? n.add(m.id) : n.delete(m.id); return n; });
    // Fetch the heavy bits only when a card is opened.
    if (opening) {
      if (m.status === 'completed' && m.results_published) loadResults([m.id]);
      if (regIds.has(m.id)) loadPositions([m.id]);
    }
  }

  async function act(m, register) {
    setBusyId(m.id); setError('');
    const { error } = await supabase.rpc(register ? 'register_for_match' : 'withdraw_from_match', { p_match_id: m.id });
    setBusyId(null);
    if (error) setError(error.message); else load();
  }

  // Opened from a notification: switch to the right list, open that match, scroll to it.
  useEffect(() => {
    if (!focusMatch || filter === null || handledFocus.current === focusMatch.n) return;
    const m = matches.find((x) => x.id === focusMatch.id);
    if (!m) return;
    handledFocus.current = focusMatch.n;
    setFilter(m.status === 'completed' ? 'completed' : 'upcoming'); setQuery(''); setLimit(1000);
    setExpanded((o) => new Set(o).add(m.id));
    if (m.status === 'completed' && m.results_published) loadResults([m.id]);
    if (regIds.has(m.id)) loadPositions([m.id]);
    setFocusId(m.id); setTimeout(() => setFocusId((f) => (f === m.id ? null : f)), 2800);
    setTimeout(() => document.getElementById(`match-${m.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 250);
  }, [focusMatch, filter, matches, regIds, loadResults, loadPositions]);

  // A match the admin has set to "live" is pinned to the top of every list, so nobody has to hunt for it.
  const liveMatches = matches.filter((m) => m.status === 'live');
  const upcomingCount = matches.filter((m) => m.status === 'open' || m.status === 'closed').length;
  const completedCount = matches.filter((m) => m.status === 'completed').length;
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = matches.filter((m) => m.status !== 'live' && (filter === 'all' || (filter === 'completed' ? m.status === 'completed' : m.status !== 'completed')));
    if (q) list = list.filter((m) => `${m.name} ${m.venue || ''} ${m.discipline || ''}`.toLowerCase().includes(q));
    // Upcoming: soonest first. Everything else: newest first.
    if (filter === 'upcoming') list = [...list].sort((a, b) => String(a.match_date).localeCompare(String(b.match_date)));
    return list;
  }, [matches, filter, query]);
  const shown = filter === 'upcoming' ? visible : visible.slice(0, limit);

  if (loading || filter === null) return <section className="sp-panel"><p className="sp-sub">Loading matches…</p></section>;

  const tabs = [['upcoming', 'Upcoming', upcomingCount], ['completed', 'Completed', completedCount], ['all', 'All', matches.length - liveMatches.length]];
  const card = (m, live = false) => <MatchCard key={m.id} m={m} live={live} registered={regIds.has(m.id)} count={counts[m.id] ?? 0} pos={positions[m.id]} res={results[m.id]}
    open={expanded.has(m.id)} onToggle={() => toggle(m)} busy={busyId === m.id} onAct={act} flash={flash === m.id} focused={focusId === m.id} />;

  return <>
    <section className="sp-panel">
      <h2>Matches</h2>
      <p className="sp-sub">Register for academy matches and follow your scores live. Once the academy publishes a completed match, everyone can see its final standings.</p>
      {error && <p className="sp-error">{error}</p>}
      {matches.length > 0 && <div className="mm-toolbar">
        <div className="mm-tabs" role="tablist" aria-label="Filter matches">
          {tabs.map(([key, label, n]) => <button key={key} type="button" role="tab" aria-selected={filter === key} className={filter === key ? 'on' : ''} onClick={() => { setFilter(key); setLimit(PAGE); }}>{label}<span>{n}</span></button>)}
        </div>
        {matches.length > PAGE && <label className="mm-search"><Search size={15} /><input type="search" value={query} onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); }} placeholder="Search matches" aria-label="Search matches" /></label>}
      </div>}
    </section>

    {liveMatches.length > 0 && !query && <div className="mm-livesection" aria-label="Live now">
      <div className="mm-livehead"><span className="mm-livepill"><i /> LIVE NOW</span><small>{liveMatches.length > 1 ? `${liveMatches.length} matches in progress` : 'A match is in progress'}</small></div>
      {liveMatches.map((m) => card(m, true))}
    </div>}

    {matches.length === 0 ? <section className="sp-panel"><div className="sp-empty"><span className="sp-ico"><Trophy /></span><p>No matches yet. When the academy organises one, you’ll be notified and can register here.</p></div></section>
      : shown.length === 0 ? <section className="sp-panel"><div className="sp-empty"><span className="sp-ico"><Trophy /></span><p>{query ? 'No matches fit your search.' : filter === 'upcoming' ? (liveMatches.length ? 'No other upcoming matches right now.' : 'No upcoming matches right now. You’ll be notified when the next one is announced.') : 'No completed matches yet.'}</p></div></section>
      : shown.map((m) => card(m))}

    {filter !== 'upcoming' && visible.length > shown.length && <button className="sp-btn ghost mm-more" type="button" onClick={() => setLimit((l) => l + PAGE)}>Show more matches ({visible.length - shown.length} older)</button>}
  </>;
}

function MatchCard({ m, live = false, registered, count, pos, res, open, onToggle, busy, onAct, flash, focused = false }) {
  const [label, tone] = STATUS[m.status] || STATUS.open;
  const completed = m.status === 'completed';
  const [tab, setTab] = useState(null); // 'mine' | 'standings'
  const activeTab = tab || (completed && !registered ? 'standings' : 'mine');
  const mine = registered && pos;

  // One-line summary shown while the card is collapsed.
  let summary = null;
  if (registered && pos?.visible && pos.rank && pos.score != null) summary = <><Trophy size={15} /><span>{completed ? 'You finished' : 'You are'} <b>{ordinal(Number(pos.rank))}</b> of {pos.total} · <b>{fmt(pos.score)}</b> / {fmt(pos.max_score)}</span></>;
  else if (registered && pos?.score != null) summary = <><Target size={15} /><span>Your score: <b>{fmt(pos.score)}</b> / {fmt(pos.max_score)}</span></>;
  else if (registered && completed) summary = <><CheckCircle2 size={15} /><span>You took part · result {m.results_published ? 'available' : 'will be published soon'}</span></>;
  else if (registered && m.status === 'live') summary = <><span className="mm-dot" /><span>Match in progress · scores update live</span></>;
  else if (m.status === 'live') summary = <><span className="mm-dot" /><span>Match in progress · registration is closed</span></>;
  else if (registered) summary = <><CheckCircle2 size={15} /><span>You’re registered{m.format === 'team' ? ' · team placement by the academy' : ''}</span></>;
  else if (completed && m.results_published) summary = <><Trophy size={15} /><span>Final standings are published</span></>;
  else if (completed) summary = <><Info size={15} /><span>Results will be published soon</span></>;

  const canRegister = !registered && m.status === 'open';
  const canWithdraw = registered && m.status === 'open';

  return <section id={`match-${m.id}`} className={`sp-panel mm-card ${open ? 'is-open' : ''} ${live ? 'is-live' : ''} ${focused ? 'is-focus' : ''}`}>
    {live && <div className="mm-livebar"><i /> Live now · scores update automatically</div>}
    <div className="mm-head">
      <div><span className={`sp-badge ${tone}`}>{label}</span><h2>{m.name}</h2></div>
      {registered && <span className="mm-registered"><CheckCircle2 size={15} /> {completed ? 'Participated' : 'Registered'}</span>}
    </div>
    <div className="mm-meta">
      <span><CalendarDays size={15} /> {fmtDay(m.match_date)}</span>
      <span><Target size={15} /> {m.discipline}{open ? ` · ${m.sheets} sheets × ${m.shots_per_sheet} shots${m.sighting_sheets > 0 ? ` + ${m.sighting_sheets} sighting (not scored)` : ''}` : ''}</span>
      {open && m.venue && <span><MapPin size={15} /> {m.venue}</span>}
      <span><Users size={15} /> {count} {completed ? 'took part' : 'registered'}</span>
      <span className="mm-format">{m.format === 'team' ? `Team match · ${m.team_size} per team` : 'Single-player'}</span>
    </div>

    {!open && summary && <div className="mm-summary">{summary}</div>}

    {open && <div className="mm-body">
      {m.description && <p className="sp-sub" style={{ marginTop: 4 }}>{m.description}</p>}

      {registered && completed && res && <div className="mm-tabs inline" role="tablist">
        <button type="button" role="tab" aria-selected={activeTab === 'mine'} className={activeTab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>My result</button>
        <button type="button" role="tab" aria-selected={activeTab === 'standings'} className={activeTab === 'standings' ? 'on' : ''} onClick={() => setTab('standings')}>Final standings</button>
      </div>}

      {mine && activeTab === 'mine' && <PositionPanel m={m} pos={pos} flash={flash} />}
      {registered && pos && !pos.visible && activeTab === 'mine' && !completed && <div className="mm-hidden"><Lock size={16} /><span>Your position is not visible yet. The academy will switch it on — you’ll get a notification. Your own score above updates live.</span></div>}

      {completed && activeTab === 'standings' && res && <Standings m={m} res={res} registered={registered} />}
      {completed && !m.results_published && <div className="mm-hidden"><Info size={16} /><span>{registered ? 'The academy hasn’t published the final results yet. You’ll get a notification when they’re out.' : 'Results for this match haven’t been published yet. Check back soon.'}</span></div>}
      {completed && m.results_published && !res && <p className="sp-sub">Loading results…</p>}
    </div>}

    <div className="mm-actions">
      {canRegister && <button className="sp-btn primary" disabled={busy} onClick={() => onAct(m, true)}>{busy ? 'Registering…' : 'Register for this match'}</button>}
      {canWithdraw && <button className="sp-btn ghost" disabled={busy} onClick={() => { if (window.confirm(`Withdraw from ${m.name}?`)) onAct(m, false); }}>{busy ? 'Please wait…' : 'Withdraw'}</button>}
      {!registered && m.status !== 'open' && !completed && <span className="mm-note"><EyeOff size={14} /> Registration is closed for this match.</span>}
      <button type="button" className="mm-toggle" aria-expanded={open} onClick={onToggle}>{open ? 'Hide details' : completed && m.results_published ? 'View results' : 'View details'}<ChevronDown size={16} className={open ? 'flip' : ''} /></button>
    </div>
  </section>;
}

// The shooter's own live position, lane plan and sheet-by-sheet scores (unchanged behaviour, now in its own component).
function PositionPanel({ m, pos, flash }) {
  const [sheet, setSheet] = useState(null);
  const sg = pos.sighting_sheets || 0;
  return <div className={`mm-position ${flash ? 'flash' : ''}`}>
    <span className={`mm-live ${m.status === 'completed' ? 'final' : ''}`}>{m.status === 'completed' ? 'Final' : <><i /> Live</>}</span>
    <div className="mm-tiles">
      <div className="mm-rank"><small>YOUR POSITION</small>
        {pos.visible && pos.rank ? <><b>{ordinal(Number(pos.rank))}</b><span>of {pos.total} scored</span></>
          : pos.visible ? <><b className="dim">—</b><span>Waiting for your score</span></>
          : <><b className="dim"><Lock size={26} /></b><span>Not shown yet</span></>}
      </div>
      <div className="mm-score"><small>YOUR SCORE</small>
        {pos.score !== null && pos.score !== undefined ? <><b>{fmt(pos.score)}</b><span>out of {fmt(pos.max_score)}{pos.inner_tens ? ` · ${pos.inner_tens} inner tens` : ''}</span></> : <><b className="dim">—</b><span>Waiting for your score</span></>}
      </div>
    </div>
    {pos.team_name && <div className="mm-teambox"><small>YOUR TEAM</small><b>{pos.team_name}</b>{pos.teammates?.length > 0 && <span>with {pos.teammates.join(', ')}</span>}</div>}
    {m.format === 'team' && !pos.team_name && <div className="mm-teambox pending"><small>TEAM</small><span>The academy will place you in a team before the match.</span></div>}
    {pos.lane_no && <div className="mm-lanebox">
      <div><small>LANE</small><b>{pos.lane_no}</b></div>
      {m.relays > 1 && pos.relay && <div><small>RELAY</small><b>{pos.relay}</b></div>}
      {pos.sheet_targets?.some(Boolean) && <div><small>TARGET SHEETS · {pos.shots_per_sheet} shots each</small>
        <div className="mm-targets">{pos.sheet_targets.map((t, i) => t ? <span key={i} className={i < sg ? 'sighting' : ''}><em>{i < sg ? `Sighting ${i + 1}` : `S${i - sg + 1}`}</em>{t}</span> : null)}</div>
        {sg > 0 && <small className="mm-sight-note">The first {sg} sheet{sg > 1 ? 's are' : ' is'} for setting up your weapon and do not count.</small>}</div>}
    </div>}
    {pos.sheets > 0 && <div className="mm-sheets">
      <small>SCORE PER SHEET · {pos.shots_per_sheet} shots each{pos.shot_scores ? ' · tap a sheet for shot-by-shot' : ''}</small>
      <div className="mm-sheet-row">{Array.from({ length: pos.sheets }, (_, i) => {
        const v = pos.sheet_scores?.[i], has = v !== null && v !== undefined, canOpen = has && pos.shot_scores?.[i]?.some((x) => x !== null), sel = sheet === i;
        return <button type="button" key={i} disabled={!canOpen} onClick={() => setSheet(sel ? null : i)} className={`mm-sheet ${has ? '' : 'empty'} ${sel ? 'sel' : ''}`}><span>Sheet {i + 1}</span><b>{has ? fmt(v) : '—'}</b>{pos.sheet_targets?.[i + sg] && <em>Target {pos.sheet_targets[i + sg]}</em>}</button>;
      })}</div>
      {sheet !== null && pos.shot_scores?.[sheet] && <div className="mm-shots">
        <small>SHEET {sheet + 1} · SHOT BY SHOT</small>
        <div className="mm-shot-row">{Array.from({ length: pos.shots_per_sheet }, (_, j) => { const x = pos.shot_scores[sheet][j], has = x !== null && x !== undefined; return <div key={j} className={`mm-shot ${has && Number(x) >= 10 ? 'ten' : ''} ${has ? '' : 'empty'}`}><span>{j + 1}</span><b>{has ? fmt(x) : '–'}</b></div>; })}</div>
      </div>}
    </div>}
  </div>;
}

// Published results – podium, team standings and the full list. Works for shooters who did NOT take part too.
function Standings({ m, res, registered }) {
  const [showAll, setShowAll] = useState(false);
  const [openRows, setOpenRows] = useState(() => new Set());
  const rows = res.rows || [], teamRows = res.teams || [];
  const me = rows.find((r) => r.is_me), top = rows.filter((r) => r.rank <= 3).slice(0, 3);
  const order = top.length === 3 ? [top[1], top[0], top[2]] : top; // 2nd · 1st · 3rd
  const tog = (i) => setOpenRows((o) => { const n = new Set(o); n.has(i) ? n.delete(i) : n.add(i); return n; });

  if (!rows.length) return <div className="mm-hidden"><Info size={16} /><span>No scores were recorded for this match.</span></div>;
  return <div className="mm-results">
    <div className="mm-final-head"><Trophy size={16} /><b>Final standings</b><span>{rows.length} shooter{rows.length > 1 ? 's' : ''} scored</span></div>
    {!registered && <div className="mm-guestnote"><Info size={15} /><span>You didn’t take part in this match. These are the results published by the academy.</span></div>}
    {registered && me && <div className="mm-me-result"><div><small>YOU FINISHED</small><b>{ordinal(Number(me.rank))}</b></div><div><small>YOUR SCORE</small><b>{fmt(me.score)}</b></div>{me.inner_tens > 0 && <div><small>INNER TENS</small><b>{me.inner_tens}</b></div>}</div>}
    <div className="mm-podium">{order.map((r, i) => <div key={i} className={`mm-pod p${r.rank} ${r.is_me ? 'me' : ''}`}>
      <span className="mm-medal">{r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : '🥉'}</span>
      <b className="mm-pod-name">{r.name}{r.is_me && <em>You</em>}</b><span className="mm-pod-score">{fmt(r.score)}</span></div>)}</div>
    {teamRows.length > 0 && <div className="mm-teams-final"><small>TEAM STANDINGS</small>{teamRows.map((t, i) => <div key={i} className={`mm-team-row ${t.is_mine ? 'me' : ''}`}>
      <span className={`mm-chip c${Math.min(t.rank, 4)}`}>{t.rank}</span><span className="mm-rl-name"><b>{t.name}</b>{t.is_mine && <em>Your team</em>}<small>{(t.members || []).join(' · ')}</small></span><span className="mm-rl-score">{fmt(t.score)}</span></div>)}</div>}
    {rows.length > top.length && <button className="sp-btn ghost" type="button" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
      {showAll ? 'Hide full list' : `See all ${rows.length} positions`} <ChevronDown size={16} className={showAll ? 'flip' : ''} />
    </button>}
    {showAll && <ol className="mm-rank-list">{rows.map((r, i) => { const ex = openRows.has(i); return <li key={i} className={r.is_me ? 'me' : ''}>
      <button type="button" onClick={() => tog(i)} aria-expanded={ex}>
        <span className={`mm-chip c${Math.min(r.rank, 4)}`}>{r.rank}</span>
        <span className="mm-rl-name"><b>{r.name}</b>{r.is_me && <em>You</em>}{r.inner_tens > 0 && <small>{r.inner_tens} inner tens</small>}</span>
        <span className="mm-rl-score">{fmt(r.score)}</span><ChevronDown size={15} className={ex ? 'flip' : ''} />
      </button>
      {ex && <div className="mm-rl-sheets">{Array.from({ length: m.sheets }, (_, j) => <div key={j}><span>S{j + 1}</span><b>{r.sheet_scores?.[j] !== null && r.sheet_scores?.[j] !== undefined ? fmt(r.sheet_scores[j]) : '—'}</b></div>)}</div>}
    </li>; })}</ol>}
  </div>;
}
