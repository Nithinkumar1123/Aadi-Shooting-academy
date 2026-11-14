import { supabase } from './supabase';

// Calls the `fee-mail` Edge Function. Never throws; always returns { ok, sent, failed, error }.
// kind: 'reminder' | 'receipt'
export async function sendFeeEmails(kind, feeIds) {
  if (!feeIds.length) return { ok: true, sent: 0, failed: 0 };
  const { data, error } = await supabase.functions.invoke('fee-mail', { body: { kind, fee_ids: feeIds } });
  if (error) {
    let message = error.message || 'Email request failed';
    try { const body = await error.context?.json?.(); if (body?.error) message = body.error; } catch { /* keep message */ }
    if (/Failed to send a request|NetworkError|Failed to fetch/i.test(message)) {
      message = 'The email service is not reachable. Has the fee-mail function been deployed? (see README)';
    }
    return { ok: false, sent: 0, failed: feeIds.length, error: message };
  }
  const firstError = (data.results || []).find((r) => !r.ok)?.error;
  return { ok: data.failed === 0, sent: data.sent, failed: data.failed, error: firstError };
}
