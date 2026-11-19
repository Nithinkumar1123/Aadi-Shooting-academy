// Helpers for family accounts: one login (one email) holding several members, e.g. a parent and children.
// Each member is a separate shooter record in the database.

export const MAX_MEMBERS = 6; // keep in sync with c_max in supabase/migrations/021_family_accounts.sql

export const REL_LABEL = { self: 'You', child: 'Child', other: 'Family member' };

export const DISCIPLINES = ['10m Air Rifle', '10m Air Pistol', '50m Rifle', 'Other'];

export const firstName = (name) => (name || '').trim().split(/\s+/)[0] || 'Member';

export const initials = (name) => {
  const p = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!p.length) return '?';
  return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
};

// Stable avatar colour per member (same member = same colour everywhere).
const TONES = ['#2f5d9e', '#b9791d', '#2f8a5b', '#8a4fa3', '#c2493d', '#1f7f8f'];
export const avatarTone = (id) => {
  let h = 0;
  for (const ch of String(id || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length];
};

export function ageFrom(dob) {
  if (!dob) return null;
  const d = new Date(dob + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

// One plain-language status per member. tone: ok | wait | bad | off
export function memberState(m) {
  if (!m) return { key: 'none', label: '', tone: 'off' };
  if (m.approval_status === 'rejected') return { key: 'rejected', label: 'Needs changes', tone: 'bad' };
  if (m.approval_status === 'pending') return { key: 'pending', label: 'Awaiting approval', tone: 'wait' };
  if (m.status === 'active') return { key: 'active', label: 'Active member', tone: 'ok' };
  if (m.archived_at) return { key: 'closed', label: 'Membership closed', tone: 'off' };
  return { key: 'hold', label: 'On hold', tone: 'wait' };
}

const keyFor = (uid) => `aadi_member_${uid}`;
export const readChosenMember = (uid) => { try { return sessionStorage.getItem(keyFor(uid)); } catch { return null; } };
export const readLastMember = (uid) => { try { return localStorage.getItem(keyFor(uid)); } catch { return null; } };
export const saveChosenMember = (uid, id) => {
  try { sessionStorage.setItem(keyFor(uid), id); } catch { /* storage may be blocked */ }
  try { localStorage.setItem(keyFor(uid), id); } catch { /* storage may be blocked */ }
};
export const clearChosenMember = (uid) => { try { sessionStorage.removeItem(keyFor(uid)); } catch { /* ignore */ } };
