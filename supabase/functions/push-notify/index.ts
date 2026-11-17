// Supabase Edge Function: delivers a notification row to every subscribed phone as a Web Push,
// so it appears on the lock screen even when the app is closed. Called by a database trigger (migration 013).
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

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const secret = env('PUSH_WEBHOOK_SECRET');
  if (!secret || req.headers.get('x-webhook-secret') !== secret) return json({ error: 'Unauthorized' }, 401);

  const n = (await req.json().catch(() => ({})))?.record;
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
  const payload = JSON.stringify({
    title: n.title,
    body: n.message,
    tag: `aadi-${n.type ?? 'note'}-${n.id}`,
    url: n.audience === 'admin' ? '/notifications' : '/',
  });

  let sent = 0; const dead: string[] = [];
  await Promise.all((subs ?? []).map(async (s: any) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 60 * 60 * 24, urgency: 'high' });
      sent++;
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) dead.push(s.id); // phone uninstalled / permission revoked
      else console.error('push failed', e?.statusCode, e?.body);
    }
  }));
  if (dead.length) await admin.from('push_subscriptions').delete().in('id', dead);
  return json({ sent, removed: dead.length });
});
