// Supabase Edge Function: sends fee emails to shooters.
//
//  1) Admin app  -> POST { kind: 'reminder' | 'receipt', fee_ids: [...] }   with the admin's login token
//  2) Daily cron -> POST { kind: 'auto' }                                    with header x-cron-secret
//
// Payments are collected offline; this function only sends the emails and records the result
// in public.fee_email_log. Secrets (never put these in the browser app):
//   RESEND_API_KEY   API key from resend.com
//   MAIL_FROM        e.g. "AADI Rifle Shooting <fees@yourdomain.com>"  (domain must be verified in Resend)
//   CRON_SECRET      any long random string (also used in the cron SQL)
//   ACADEMY_NAME     optional, default "AADI Rifle Shooting"
//   PAYMENT_HELP     optional, text shown in reminders, e.g. "Pay at the front desk (cash or UPI)."
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically by Supabase.

import { createClient } from 'npm:@supabase/supabase-js@2';

const REMIND_DAYS_BEFORE = 3;   // start reminding this many days before the due date
const REPEAT_EVERY_DAYS = 3;    // then repeat at most this often until paid
const ADMIN_ROLES = ['super_admin', 'admin', 'reception'];

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const env = (k: string) => Deno.env.get(k) ?? '';
const ACADEMY = env('ACADEMY_NAME') || 'AADI Rifle Shooting';
const PAYMENT_HELP = env('PAYMENT_HELP') || 'Please pay at the academy front desk (cash or UPI). Once we record your payment you will get a confirmation email.';

const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const inr = (n: number) => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmtDate = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const METHOD: Record<string, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', bank_transfer: 'Bank transfer', other: 'Other' };

function layout(title: string, bodyHtml: string) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;background:#f4f6fa;padding:24px">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e5e9ef;border-radius:14px;overflow:hidden">
    <div style="background:#14213a;color:#fff;padding:18px 24px;font-weight:700;letter-spacing:.08em;font-size:13px">${esc(ACADEMY.toUpperCase())}</div>
    <div style="padding:24px;color:#172238;font-size:15px;line-height:1.6"><h2 style="margin:0 0 14px;font-size:20px">${esc(title)}</h2>${bodyHtml}</div>
    <div style="padding:14px 24px;background:#f7f9fc;color:#8792a4;font-size:12px">This is an automated message from ${esc(ACADEMY)}.</div>
  </div></div>`;
}
const row = (k: string, v: string) => `<tr><td style="padding:6px 0;color:#7e899a">${esc(k)}</td><td style="padding:6px 0;text-align:right;font-weight:700">${esc(v)}</td></tr>`;

// `shared` = this login holds several family members, so the message must say WHICH member it is about.
const firstName = (n: string) => String(n ?? '').trim().split(/\s+/)[0] || 'your family member';

function reminderEmail(f: any, name: string, today: string, shared = false) {
  const diff = daysBetween(today, f.due_date);
  const when = diff < 0 ? `was due ${-diff} day${diff === -1 ? '' : 's'} ago` : diff === 0 ? 'is due today' : `is due in ${diff} day${diff === 1 ? '' : 's'}`;
  const base = diff < 0 ? `Fee overdue: ${f.title} (${inr(f.amount)})` : `Fee reminder: ${f.title} (${inr(f.amount)})`;
  const subject = shared ? `${firstName(name)} – ${base}` : base;
  const html = layout('Fee payment reminder', `
    <p>${shared ? 'Hello,' : `Hi ${esc(name)},`}</p>
    <p>This is a friendly reminder that ${shared ? `the fee <b>${esc(f.title)}</b> for <b>${esc(name)}</b>` : `your fee <b>${esc(f.title)}</b>`} ${when}.</p>
    <table style="width:100%;border-collapse:collapse;border-top:1px solid #eef1f5;border-bottom:1px solid #eef1f5;margin:14px 0">
      ${row('Amount', inr(f.amount))}${row('Due date', fmtDate(f.due_date))}
    </table>
    <p>${esc(PAYMENT_HELP)}</p>
    <p style="color:#7e899a;font-size:13px">Already paid? Please ignore this email — it can take a little time for us to record it.</p>`);
  const text = `${shared ? 'Hello,' : `Hi ${name},`}\n\nReminder: ${shared ? `the fee "${f.title}" for ${name}` : `your fee "${f.title}"`} ${when}.\nAmount: ${inr(f.amount)}\nDue date: ${fmtDate(f.due_date)}\n\n${PAYMENT_HELP}\n\n${ACADEMY}`;
  return { subject, html, text };
}

function receiptEmail(f: any, name: string, shared = false) {
  const paidOn = new Date(f.paid_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
  const baseSubject = `Payment received: ${f.title} (${inr(f.amount)})`;
  const subject = shared ? `${firstName(name)} – ${baseSubject}` : baseSubject;
  const html = layout('Payment received — thank you!', `
    <p>${shared ? 'Hello,' : `Hi ${esc(name)},`}</p>
    <p>We have received your payment for <b>${esc(f.title)}</b>${shared ? ` for <b>${esc(name)}</b>` : ''}.</p>
    <table style="width:100%;border-collapse:collapse;border-top:1px solid #eef1f5;border-bottom:1px solid #eef1f5;margin:14px 0">
      ${row('Amount paid', inr(f.amount))}${row('Paid on', paidOn)}${row('Method', METHOD[f.payment_method] ?? '—')}
      ${f.payment_reference ? row('Reference', f.payment_reference) : ''}${row('Receipt no.', f.id.slice(0, 8).toUpperCase())}
    </table>
    <p>Keep this email as your receipt. See you at the range!</p>`);
  const text = `${shared ? 'Hello,' : `Hi ${name},`}\n\nWe have received your payment for "${f.title}"${shared ? ` for ${name}` : ''}.\nAmount: ${inr(f.amount)}\nPaid on: ${paidOn}\nMethod: ${METHOD[f.payment_method] ?? '-'}\n${f.payment_reference ? 'Reference: ' + f.payment_reference + '\n' : ''}Receipt no.: ${f.id.slice(0, 8).toUpperCase()}\n\nThank you,\n${ACADEMY}`;
  return { subject, html, text };
}

async function sendMail(to: string, m: { subject: string; html: string; text: string }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env('MAIL_FROM'), to: [to], subject: m.subject, html: m.html, text: m.text }),
  });
  if (!res.ok) throw new Error(`Email provider error ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// Sends one email for one fee, logs the outcome, updates reminder counters. Never throws.
async function processFee(fee: any, kind: 'reminder' | 'receipt', trigger: 'manual' | 'auto') {
  const shooter = fee.shooters;
  const log = async (status: 'sent' | 'failed', error?: string) => {
    await admin.from('fee_email_log').insert({ fee_id: fee.id, shooter_id: fee.shooter_id, kind, trigger, to_email: shooter?.email ?? null, status, error: error ?? null });
  };
  try {
    if (kind === 'reminder' && fee.status !== 'pending') throw new Error('Fee is already paid');
    if (kind === 'receipt' && fee.status !== 'paid') throw new Error('Fee is not marked as paid');
    if (!shooter?.email) throw new Error('Shooter has no email address on file');
    if (!env('RESEND_API_KEY') || !env('MAIL_FROM')) throw new Error('Email is not configured (RESEND_API_KEY / MAIL_FROM missing)');
    // Several members on one login share this inbox: name the member in the subject and body.
    let shared = false;
    if (shooter.user_id) {
      const { count } = await admin.from('shooters').select('id', { count: 'exact', head: true }).eq('user_id', shooter.user_id);
      shared = (count ?? 0) > 1;
    }
    const mail = kind === 'reminder' ? reminderEmail(fee, shooter.full_name, todayIST(), shared) : receiptEmail(fee, shooter.full_name, shared);
    await sendMail(shooter.email, mail);
    await log('sent');
    if (kind === 'reminder') {
      await admin.from('fees').update({ last_reminder_at: new Date().toISOString(), reminder_count: (fee.reminder_count ?? 0) + 1 }).eq('id', fee.id);
    }
    return { fee_id: fee.id, ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await log('failed', msg);
    return { fee_id: fee.id, ok: false, error: msg };
  }
}

const FEE_SELECT = '*, shooters(full_name, email, user_id)';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body: any = {};
  try { body = await req.json(); } catch { /* empty body is fine for cron */ }

  // ---- Scheduled run (daily cron) ----
  const cronSecret = req.headers.get('x-cron-secret');
  if (cronSecret) {
    if (!env('CRON_SECRET') || cronSecret !== env('CRON_SECRET')) return json({ error: 'Forbidden' }, 403);
    const today = todayIST();
    const horizon = new Date(Date.parse(today + 'T00:00:00Z') + REMIND_DAYS_BEFORE * 86400000).toISOString().slice(0, 10);
    const { data: fees, error } = await admin.from('fees').select(FEE_SELECT).eq('status', 'pending').lte('due_date', horizon);
    if (error) return json({ error: error.message }, 500);
    const cutoff = Date.now() - (REPEAT_EVERY_DAYS * 86400000 - 3600000); // 1h grace so a daily job never skips a cycle
    const due = (fees ?? []).filter((f) => !f.last_reminder_at || Date.parse(f.last_reminder_at) <= cutoff);
    const results = [];
    for (const f of due) results.push(await processFee(f, 'reminder', 'auto'));
    return json({ checked: fees?.length ?? 0, attempted: results.length, sent: results.filter((r) => r.ok).length, results });
  }

  // ---- Admin request from the app ----
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Not signed in' }, 401);
  const { data: u, error: uerr } = await admin.auth.getUser(token);
  if (uerr || !u?.user) return json({ error: 'Invalid session' }, 401);
  const { data: prof } = await admin.from('profiles').select('role').eq('id', u.user.id).maybeSingle();
  if (!prof || !ADMIN_ROLES.includes(prof.role)) return json({ error: 'Admins only' }, 403);

  const kind = body.kind;
  const ids: string[] = Array.isArray(body.fee_ids) ? body.fee_ids.slice(0, 200) : [];
  if ((kind !== 'reminder' && kind !== 'receipt') || ids.length === 0) return json({ error: 'kind (reminder|receipt) and fee_ids are required' }, 400);

  const { data: fees, error } = await admin.from('fees').select(FEE_SELECT).in('id', ids);
  if (error) return json({ error: error.message }, 500);
  const results = [];
  for (const f of fees ?? []) results.push(await processFee(f, kind, 'manual'));
  return json({ sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results });
});
