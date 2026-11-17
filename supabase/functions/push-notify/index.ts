// Supabase Edge Function: delivers a notification row to every subscribed phone as a Web Push,
// so it appears on the lock screen even when the app is closed. Called by a database trigger (migration 013).
// Also answers the in-app "Send test" button ({ test: true } from a signed-in user).
//
// Secrets (supabase secrets set ...):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY   from:  npx web-push generate-vapid-keys
//   VAPID_SUBJECT                         e.g. mailto:you@yourdomain.com
//   PUSH_WEBHOOK_SECRET                   any long random string (same value you put in push_config)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const env = (k: string) => Deno.env.get(k) ?? '';
const ADMIN_ROLES = ['super_admin', 'admin', 'reception'];
const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:admin@example.com', env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// If a phone is switched off / offline, the push service keeps the message this long and delivers it when the phone is back.
const HOLD_SECONDS = 60 * 60 * 24 * 7;

async function deliver(subs: any[], payload: string) {
  let sent = 0;
  const dead: string[] = [];
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: HOLD_SECONDS, urgency: 'high' });
      sent++;
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) dead.push(s.id); // phone uninstalled / permission revoked
      else console.error('push failed', e?.statusCode, e?.body);
    }
  }));
  if (dead.length) await admin.from('push_subscriptions').delete().in('id', dead);
  return { sent, removed: dead.length };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const body = await req.json().catch(() => ({}));

  // "Send test": a signed-in user sends a test push to their own phones.
  if (body?.test) {
    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: u } = await admin.auth.getUser(token);
    if (!u?.user) return json({ error: 'Please sign in first' }, 401);
    const { data: mine } = await admin.from('push_subscriptions').select('id,endpoint,p256dh,auth').eq('user_id', u.user.id);
    if (!mine?.length) return json({ sent: 0, error: 'No phone is registered for alerts yet. Turn on alerts first.' });
    return json(await deliver(mine, JSON.stringify({
      title: 'AADI test notification',
      body: 'Phone alerts are working. You will see messages like this on your lock screen.',
      tag: 'aadi-test-' + Date.now(),
      url: '/',
    })));
  }

  // Normal path: called by the database trigger with the shared secret.
  const secret = env('PUSH_WEBHOOK_SECRET');
  if (!secret || req.headers.get('x-webhook-secret') !== secret) return json({ error: 'Unauthorized' }, 401);

  const n = body?.record;
  if (!n?.title) return json({ error: 'No notification record' }, 400);

  // Who should get it?
  let userIds: string[] = [];
  if (n.audience === 'admin') {
    const { data } = await admin.from('profiles').select('id').in('role', ADMIN_ROLES);
    userIds = (data ?? []).map((r: any) => r.id);
  } else if (n.audience === 'shooter' && n.shooter_id) {
    const { data } = await admin.from('shooters').select('user_id').eq('id', n.shooter_id).maybeSingle();
    if (data?.user_id) userIds = [data.user_id];
  }
  if (!userIds.length) return json({ sent: 0 });

  const { data: subs } = await admin.from('push_subscriptions').select('id,endpoint,p256dh,auth').in('user_id', userIds);
  return json(await deliver(subs ?? [], JSON.stringify({
    title: n.title,
    body: n.message,
    tag: `aadi-${n.type ?? 'note'}-${n.id}`,
    url: n.audience === 'admin' ? '/notifications' : '/',
  })));
});
