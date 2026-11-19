// Where a notification should take the person when they tap it.
// Shooter side -> a portal tab (+ the match to open, when there is one). Admin side -> a page of the workspace.

const SHOOTER = {
  score_published:         { tab: 'scores',  label: 'View scores' },
  fee_added:               { tab: 'fees',    label: 'View fees' },
  fee_paid:                { tab: 'fees',    label: 'View fees' },
  fee_overdue:             { tab: 'fees',    label: 'Pay / view fees' },
  fee_reminder:            { tab: 'fees',    label: 'Pay / view fees' },
  match_announced:         { tab: 'matches', label: 'View match' },
  match_registration:      { tab: 'matches', label: 'View match' },
  match_positions_open:    { tab: 'matches', label: 'See my position' },
  match_results_published: { tab: 'matches', label: 'See results' },
  match_lane_assigned:     { tab: 'matches', label: 'See my lane' },
  approval_approved:       { tab: 'overview', label: 'Open dashboard' },
  approval_rejected:       { tab: 'overview', label: 'Review application' },
  exit_approved:           { tab: 'overview', label: 'Open dashboard' },
  exit_rejected:           { tab: 'overview', label: 'Open dashboard' },
  membership_restored:     { tab: 'overview', label: 'Open dashboard' },
};

const ADMIN = {
  new_registration:         { path: '/approvals', label: 'Review request' },
  registration_resubmitted: { path: '/approvals', label: 'Review request' },
  shooter_exit_request:     { path: '/shooters',  label: 'Review request' },
  fee_added:                { path: '/payments',  label: 'Open fees' },
  fee_paid:                 { path: '/payments',  label: 'Open fees' },
  fee_overdue:              { path: '/payments',  label: 'Open fees' },
  fee_reminder:             { path: '/payments',  label: 'Open fees' },
  score_published:          { path: '/scores',    label: 'Open scores' },
  match_registration:       { path: '/matches',   label: 'Open matches' },
};

export const SHOOTER_TABS = ['overview', 'attendance', 'scores', 'matches', 'fees', 'notifications', 'qr'];

// -> { tab | path, matchId?, label } or null when the notification has nowhere to go.
export function notificationTarget(n, audience) {
  const t = (audience === 'admin' ? ADMIN : SHOOTER)[n?.type];
  if (!t) return null;
  return { ...t, matchId: n?.data?.match_id || null };
}

// Deep link used by push notifications and the service worker, e.g. /?tab=matches&match=<id>&member=<id>
export function shooterDeepLink({ type, matchId, shooterId }) {
  const t = SHOOTER[type];
  if (!t) return '/';
  const q = new URLSearchParams({ tab: t.tab });
  if (matchId) q.set('match', matchId);
  if (shooterId) q.set('member', shooterId);
  return `/?${q.toString()}`;
}

// Reads (and removes) ?tab= / ?match= / ?member= from the address bar so a refresh doesn't re-trigger it.
// The first result is remembered, so calling it twice (React StrictMode) still returns the same link.
let captured = null;
export function consumeDeepLink() {
  if (!captured) captured = parseDeepLink();
  return captured;
}
function parseDeepLink() {
  try {
    const u = new URL(window.location.href), p = u.searchParams;
    const tab = p.get('tab'), match = p.get('match'), member = p.get('member');
    if (!tab && !match && !member) return { tab: null, match: null, member: null };
    ['tab', 'match', 'member'].forEach((k) => p.delete(k));
    window.history.replaceState({}, '', u.pathname + (p.toString() ? `?${p}` : '') + u.hash);
    return { tab: SHOOTER_TABS.includes(tab) ? tab : null, match, member };
  } catch { return { tab: null, match: null, member: null }; }
}
