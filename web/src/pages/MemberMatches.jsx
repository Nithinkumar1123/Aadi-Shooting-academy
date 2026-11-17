import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, CheckCircle2, ChevronDown, EyeOff, Lock, MapPin, Medal, Target, Trophy, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { fmtDay } from '../lib/format';

const STATUS = { open: ['Registration open', 'live'], closed: ['Registration closed', 'late'], live: ['Match live', 'live'], completed: ['Completed', 'ok'] };
const fmt = (n) => (Math.round(Number(n) * 10) / 10).toFixed(1);
const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

// Shooter's Matches tab. Shows every match, lets the shooter register / withdraw, and – only when the
// admin has allowed it for that match – shows THEIR OWN position, refreshed live as scores change.
export default function MemberMatches({ shooter }) {
  const [matches, setMatches] = useState([]);
  const [regIds, setRegIds] = useState(new Set());
  const [counts, setCounts] = useState({});
  const [positions, setPositions] = useState({}); // matchId -> result of my_match_position
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState(null); // matchId whose position just changed
  const [results, setResults] = useState({}); // matchId -> full results rows (only when published after completion)
  const [openResults, setOpenResults] = useState(() => new Set());
  const [openSheet, setOpenSheet] = useState({}); // matchId -> sheet index whose shots are shown

  const loadPositions = useCallback(async (list, regs) => {
    const targets = list.filter((m) => regs.has(m.id));
    const results = await Promise.all(targets.map(async (m) => [m.id, (await supabase.rpc('my_match_position', { p_match_id: m.id })).data]));
    setPositions((old) => {
      const next = { ...old };
      results.forEach(([id, data]) => {
        if (!data) return;
        const was = old[id], changed = was && (was.rank !== data.rank || was.score !== data.score);
        next[id] = data;
        if (changed) { setFlash(id); setTimeout(() => setFlash((f) => (f === id ? null : f)), 2500); }
      });
      return next;
    });
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
    const c = {};
    await Promise.all(list.filter((x) => x.status !== 'completed' || regs.has(x.id)).map(async (x) => { c[x.id] = (await supabase.rpc('match_registration_count', { p_match_id: x.id })).data || 0; }));
    setCounts(c);
    await loadPositions(list, regs);
    const pub = list.filter((x) => regs.has(x.id) && x.status === 'completed' && x.results_published);
    const full = await Promise.all(pub.map(async (x) => [x.id, (await supabase.rpc('match_full_results', { p_match_id: x.id })).data]));
    setResults(Object.fromEntries(full.filter(([, d]) => d?.available).map(([id, d]) => [id, d.rows])));
    setLoading(false);
  }, [shooter.id, loadPositions]);

  useEffect(() => {
    load();
    // Any match change (status, permission, or a score bump from the admin) -> refresh live.
    const ch = supabase.channel(`aadi-member-matches-${shooter.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_registrations', filter: `shooter_id=eq.${shooter.id}` }, load)
      .subscribe();
    const poll = window.setInterval(load, 20000); // safety net if realtime is unavailable
    return () => { window.clearInterval(poll); supabase.removeChannel(ch); };
  }, [load, shooter.id]);

  async function act(m, register) {
    setBusyId(m.id); setError('');
    const { error } = await supabase.rpc(register ? 'register_for_match' : 'withdraw_from_match', { p_match_id: m.id });
    setBusyId(null);
    if (error) setError(error.message); else load();
  }

  if (loading) return <section className="sp-panel"><p className="sp-sub">Loading matches…</p></section>;

  return <>
    <section className="sp-panel">
      <h2>Matches</h2>
      <p className="sp-sub">Register for academy matches. Your sheet-wise scores appear here live as they are entered. Your position shows when the academy allows it, and everyone’s results are shared after the match is completed and published.</p>
      {error && <p className="sp-error">{error}</p>}
    </section>

    {matches.length === 0 ? <section className="sp-panel"><div className="sp-empty"><span className="sp-ico"><Trophy /></span><p>No matches yet. When the academy organises one, you’ll be notified and can register here.</p></div></section> :
      matches.map((m) => {
        const registered = regIds.has(m.id), pos = positions[m.id], [label, tone] = STATUS[m.status] || STATUS.open;
        return <section className="sp-panel mm-card" key={m.id}>
          <div className="mm-head">
            <div><span className={`sp-badge ${tone}`}>{label}</span><h2>{m.name}</h2></div>
            {registered && <span className="mm-registered"><CheckCircle2 size={15} /> Registered</span>}
          </div>
          <div className="mm-meta">
            <span><CalendarDays size={15} /> {fmtDay(m.match_date)}</span>
            <span><Target size={15} /> {m.discipline} · {m.sheets} sheets × {m.shots_per_sheet} shots{m.sighting_sheets > 0 ? ` + ${m.sighting_sheets} sighting (not scored)` : ''}</span>
            {m.venue && <span><MapPin size={15} /> {m.venue}</span>}
            <span><Users size={15} /> {counts[m.id] ?? 0} registered</span>
          </div>
          {m.description && <p className="sp-sub" style={{ marginTop: 10 }}>{m.description}</p>}

          {registered && pos && <div className={`mm-position ${flash === m.id ? 'flash' : ''}`}>
            <span className="mm-live"><i /> Live</span>
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
            {pos.lane_no && <div className="mm-lanebox">
              <div><small>LANE</small><b>{pos.lane_no}</b></div>
              {m.relays > 1 && pos.relay && <div><small>RELAY</small><b>{pos.relay}</b></div>}
              {pos.sheet_targets?.some(Boolean) && <div><small>TARGET SHEETS · {pos.shots_per_sheet} shots each</small>
                <div className="mm-targets">{pos.sheet_targets.map((t, i) => { const sg = pos.sighting_sheets || 0; return t ? <span key={i} className={i < sg ? 'sighting' : ''}><em>{i < sg ? `Sighting ${i + 1}` : `S${i - sg + 1}`}</em>{t}</span> : null; })}</div>
                {(pos.sighting_sheets || 0) > 0 && <small className="mm-sight-note">The first {pos.sighting_sheets} sheet{pos.sighting_sheets > 1 ? 's are' : ' is'} for setting up your weapon and do not count.</small>}</div>}
            </div>}
            {pos.sheets > 0 && <div className="mm-sheets">
              <small>SCORE PER SHEET · {pos.shots_per_sheet} shots each{pos.shot_scores ? ' · tap a sheet for shot-by-shot' : ''}</small>
              <div className="mm-sheet-row">{Array.from({ length: pos.sheets }, (_, i) => { const v = pos.sheet_scores?.[i]; const has = v !== null && v !== undefined; const canOpen = has && pos.shot_scores?.[i]?.some((x) => x !== null); const sel = openSheet[m.id] === i;
                return <button type="button" key={i} disabled={!canOpen} onClick={() => setOpenSheet((o) => ({ ...o, [m.id]: sel ? null : i }))} className={`mm-sheet ${has ? '' : 'empty'} ${sel ? 'sel' : ''}`}><span>Sheet {i + 1}</span><b>{has ? fmt(v) : '—'}</b>{pos.sheet_targets?.[i + (pos.sighting_sheets || 0)] && <em>Target {pos.sheet_targets[i + (pos.sighting_sheets || 0)]}</em>}</button>; })}</div>
              {openSheet[m.id] !== null && openSheet[m.id] !== undefined && pos.shot_scores?.[openSheet[m.id]] && <div className="mm-shots">
                <small>SHEET {openSheet[m.id] + 1} · SHOT BY SHOT</small>
                <div className="mm-shot-row">{Array.from({ length: pos.shots_per_sheet }, (_, j) => { const x = pos.shot_scores[openSheet[m.id]][j]; const has = x !== null && x !== undefined; return <div key={j} className={`mm-shot ${has && Number(x) >= 10 ? 'ten' : ''} ${has ? '' : 'empty'}`}><span>{j + 1}</span><b>{has ? fmt(x) : '–'}</b></div>; })}</div>
              </div>}
            </div>}
          </div>}
          {registered && pos && !pos.visible && <div className="mm-hidden"><Lock size={16} /><span>Your position is not visible yet. The academy will switch it on — you’ll get a notification. Your own score above updates live.</span></div>}

          {results[m.id] && (() => {
            const rows = results[m.id], me = rows.find((r) => r.is_me), top = rows.filter((r) => r.rank <= 3).slice(0, 3);
            const order = top.length === 3 ? [top[1], top[0], top[2]] : top; // 2nd · 1st · 3rd
            const open = openResults.has(m.id);
            return <div className="mm-results">
              <div className="mm-final-head"><Trophy size={16} /><b>Final results</b><span>{rows.length} shooters</span></div>
              {me && <div className="mm-me-result"><div><small>YOU FINISHED</small><b>{ordinal(Number(me.rank))}</b></div><div><small>YOUR SCORE</small><b>{fmt(me.score)}</b></div>{me.inner_tens > 0 && <div><small>INNER TENS</small><b>{me.inner_tens}</b></div>}</div>}
              <div className="mm-podium">{order.map((r, i) => <div key={i} className={`mm-pod p${r.rank} ${r.is_me ? 'me' : ''}`}>
                <span className="mm-medal">{r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : '🥉'}</span>
                <b className="mm-pod-name">{r.name}{r.is_me && <em>You</em>}</b><span className="mm-pod-score">{fmt(r.score)}</span></div>)}</div>
              <button className="sp-btn ghost" type="button" aria-expanded={open} onClick={() => setOpenResults((o) => { const n = new Set(o); n.has(m.id) ? n.delete(m.id) : n.add(m.id); return n; })}>
                {open ? 'Hide full list' : 'See all positions'} <ChevronDown size={16} className={open ? 'flip' : ''} />
              </button>
              {open && <ol className="mm-rank-list">{rows.map((r, i) => { const key = `${m.id}:${i}`, ex = !!openSheet[key]; return <li key={i} className={r.is_me ? 'me' : ''}>
                <button type="button" onClick={() => setOpenSheet((o) => ({ ...o, [key]: !o[key] }))} aria-expanded={ex}>
                  <span className={`mm-chip c${Math.min(r.rank, 4)}`}>{r.rank}</span>
                  <span className="mm-rl-name"><b>{r.name}</b>{r.is_me && <em>You</em>}{r.inner_tens > 0 && <small>{r.inner_tens} inner tens</small>}</span>
                  <span className="mm-rl-score">{fmt(r.score)}</span><ChevronDown size={15} className={ex ? 'flip' : ''} />
                </button>
                {ex && <div className="mm-rl-sheets">{Array.from({ length: m.sheets }, (_, j) => <div key={j}><span>S{j + 1}</span><b>{r.sheet_scores?.[j] !== null && r.sheet_scores?.[j] !== undefined ? fmt(r.sheet_scores[j]) : '—'}</b></div>)}</div>}
              </li>; })}</ol>}
            </div>;
          })()}

          <div className="mm-actions">
            {!registered && m.status === 'open' && <button className="sp-btn primary" disabled={busyId === m.id} onClick={() => act(m, true)}>{busyId === m.id ? 'Registering…' : 'Register for this match'}</button>}
            {registered && m.status === 'open' && <button className="sp-btn ghost" disabled={busyId === m.id} onClick={() => { if (window.confirm(`Withdraw from ${m.name}?`)) act(m, false); }}>{busyId === m.id ? 'Please wait…' : 'Withdraw'}</button>}
            {!registered && m.status !== 'open' && <span className="mm-note"><EyeOff size={14} /> Registration is closed for this match.</span>}
          </div>
        </section>;
      })}
  </>;
}
