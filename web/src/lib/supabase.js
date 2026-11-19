import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && anonKey && !url.includes('YOUR_PROJECT'));

// Family accounts: one login can hold several members (parent + children). The member currently being
// viewed is sent with every data request so "act as me" database functions (my QR, match registration,
// leave request ...) apply to that member. The database only honours it if the member belongs to the
// signed-in login (see migration 021), so this header can never be used to act as someone else's member.
let activeMemberId = null;
export function setActiveMember(id) { activeMemberId = id || null; }

function memberAwareFetch(input, init) {
  const target = typeof input === 'string' ? input : input?.url || '';
  if (!activeMemberId || !target.includes('/rest/v1/')) return fetch(input, init);
  const headers = new Headers(init?.headers || (typeof input !== 'string' ? input.headers : undefined));
  headers.set('x-aadi-member', activeMemberId);
  return fetch(input, { ...init, headers });
}

export const supabase = supabaseConfigured ? createClient(url, anonKey, { global: { fetch: memberAwareFetch } }) : null;
