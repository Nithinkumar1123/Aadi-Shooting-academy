// Rule-based performance insights for a shooter ("where do I need to improve?").
// Pure functions, no network: give it the shooter's scores + attendance and it returns plain-language tips.
import { dayKey } from './format.js';

export const scorePct = (s) => (s.max_score > 0 ? (Number(s.score) / Number(s.max_score)) * 100 : 0);
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const stdev = (a) => { if (a.length < 2) return 0; const m = avg(a); return Math.sqrt(avg(a.map((x) => (x - m) ** 2))); };
// Spread of values around their straight-line trend, so a steady climb is not mistaken for "swinging".
function residualSd(a) {
  const n = a.length; if (n < 3) return stdev(a);
  const xm = (n - 1) / 2, ym = avg(a);
  let num = 0, den = 0;
  a.forEach((y, i) => { num += (i - xm) * (y - ym); den += (i - xm) ** 2; });
  const slope = num / den;
  return Math.sqrt(avg(a.map((y, i) => (y - (ym + slope * (i - xm))) ** 2)));
}
const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;

// Oldest -> newest.
export const sortScores = (scores) =>
  [...scores].sort((a, b) => (a.session_date + a.created_at).localeCompare(b.session_date + b.created_at));

export function summarizeScores(scores) {
  const s = sortScores(scores);
  if (!s.length) return { count: 0, avgPct: 0, bestPct: 0, latestPct: 0, best: null, latest: null, recentAvgPct: 0, trend: null };
  const pcts = s.map(scorePct);
  const best = s[pcts.indexOf(Math.max(...pcts))];
  const recent = pcts.slice(-3);
  const prev = pcts.slice(-6, -3);
  return {
    count: s.length,
    avgPct: avg(pcts), bestPct: Math.max(...pcts), latestPct: pcts[pcts.length - 1],
    best, latest: s[s.length - 1],
    recentAvgPct: avg(recent),
    trend: prev.length ? avg(recent) - avg(prev) : null, // percentage points, recent 3 vs the 3 before
  };
}

// Attendance helpers: distinct days attended.
export function attendanceStats(attendance, now = new Date()) {
  const days = new Set(attendance.map((a) => dayKey(a.checked_in_at)));
  const since = new Date(now); since.setDate(since.getDate() - 30);
  const last30 = new Set(attendance.filter((a) => new Date(a.checked_in_at) >= since).map((a) => dayKey(a.checked_in_at)));
  const thisMonth = new Set(attendance.filter((a) => {
    const d = new Date(a.checked_in_at); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).map((a) => dayKey(a.checked_in_at)));
  const latest = attendance.length ? attendance.reduce((m, a) => (a.checked_in_at > m ? a.checked_in_at : m), attendance[0].checked_in_at) : null;
  const daysSinceLast = latest ? Math.floor((now - new Date(latest)) / 86400000) : null;
  return { totalDays: days.size, last30: last30.size, thisMonth: thisMonth.size, daysSinceLast, dayKeys: days };
}

/**
 * Returns [{ tone: 'improve' | 'good' | 'info', title, detail }]
 *   improve = something to work on, good = going well, info = neutral tip
 */
export function buildInsights({ scores = [], attendance = [], now = new Date() }) {
  const out = [];
  const add = (tone, title, detail) => out.push({ tone, title, detail });
  const s = sortScores(scores);
  const att = attendanceStats(attendance, now);

  // ---- Attendance ----
  if (att.totalDays === 0) {
    add('info', 'No sessions recorded yet', 'Your attendance is recorded when you scan your QR at the front desk. Regular practice is the fastest way to improve.');
  } else if (att.last30 <= 3) {
    add('improve', att.last30 === 0 ? 'No sessions in the last 30 days' : `Only ${att.last30} session${att.last30 === 1 ? '' : 's'} in the last 30 days`, 'Aim for at least 2 sessions a week. Short, regular practice builds steadiness faster than occasional long sessions.');
  } else if (att.last30 >= 8) {
    add('good', `Great consistency: ${att.last30} sessions in the last 30 days`, 'Regular practice is paying off. Keep the rhythm going.');
  }
  if (att.daysSinceLast !== null && att.daysSinceLast > 14 && att.last30 > 3) {
    add('improve', `It has been ${att.daysSinceLast} days since your last session`, 'Long breaks cost you rhythm and muscle memory. Book your next session soon.');
  }

  // ---- Scores ----
  if (s.length === 0) {
    add('info', 'No scores recorded yet', 'Once your coach records your practice scores, your trend and tips will appear here.');
    return out;
  }
  const pcts = s.map(scorePct);
  const sum = summarizeScores(s);

  if (s.length < 3) {
    add('info', 'Keep shooting to unlock more tips', `You have ${s.length} scored session${s.length === 1 ? '' : 's'}. Trend and consistency tips start after 3.`);
  } else {
    if (sum.trend !== null) {
      if (sum.trend >= 1) add('good', `Improving: up ${r1(sum.trend)} points`, 'Your last 3 sessions average higher than the 3 before. Keep following what you are doing in practice.');
      else if (sum.trend <= -1) add('improve', `Scores slipped ${r1(-sum.trend)} points recently`, 'Your last 3 sessions average lower than the 3 before. Talk to your coach about stance, grip and focus, and avoid shooting when tired.');
      else add('info', 'Scores are steady', 'No big change over your recent sessions. To move up, pick one technique to work on each session.');
    }
    const sd = residualSd(pcts.slice(-6));
    if (s.length >= 4 && sd >= 3) add('improve', 'Scores swing from session to session', `Your recent results vary by about ±${r1(sd)} points. A repeatable pre-shot routine (breathing, hold, release) steadies this.`);
    else if (s.length >= 4 && sd <= 1.5 && !(sum.trend !== null && sum.trend <= -1)) add('good', 'Very consistent scores', 'Your results are tightly grouped. That is the base for pushing the average higher.');
    if (sum.bestPct - sum.latestPct >= 3) add('info', `Your best is ${r1(sum.bestPct)}%, last session ${r1(sum.latestPct)}%`, 'You have already shot higher. Think about what was different on your best day: sleep, warm-up, equipment, mindset.');
  }

  // ---- Shot-by-shot (only when the coach recorded individual shots) ----
  const detailed = s.filter((x) => Array.isArray(x.shot_values) && x.shot_values.length >= 6).slice(-5);
  if (detailed.length === 0) {
    add('info', 'Want deeper tips?', 'Ask your coach to record shot-by-shot scores. Then we can spot slow starts, late fatigue and weak shots.');
  } else {
    const shots = detailed.map((x) => x.shot_values.map(Number));
    const firstHalf = avg(shots.map((v) => avg(v.slice(0, Math.floor(v.length / 2)))));
    const secondHalf = avg(shots.map((v) => avg(v.slice(Math.ceil(v.length / 2)))));
    const diff = secondHalf - firstHalf;
    if (diff <= -0.15) add('improve', 'You fade late in the string', `Your second-half shots average ${r2(-diff)} lower than your first half. Work on stamina and focus: longer holds, pace your rhythm, take a breath before the final shots.`);
    else if (diff >= 0.15) add('improve', 'Slow starts', `Your first-half shots average ${r2(diff)} lower than your second half. Use sighting shots and a proper warm-up so you settle in sooner.`);
    else add('good', 'Even through the whole string', 'Your first and second halves score about the same. Good focus from start to finish.');

    const all = shots.flat();
    const weak = all.filter((v) => v < 9).length / all.length;
    if (weak >= 0.15) add('improve', `${Math.round(weak * 100)}% of your shots are below 9`, 'Those stray shots cost the most. Check what happens right before them: rushing the release, a flinch, or losing the hold.');
    else if (weak <= 0.05) add('good', 'Very few stray shots', `Only ${Math.round(weak * 100)}% of your shots are below 9. Your shot-to-shot control is strong.`);

    const spread = avg(shots.map(stdev));
    if (spread >= 0.6) add('improve', 'Shot-to-shot variation is high', 'Your shots spread widely within a string. Focus on a smooth, identical follow-through for every shot.');
  }
  return out;
}
