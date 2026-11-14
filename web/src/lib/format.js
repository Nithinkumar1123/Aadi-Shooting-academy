// Small shared helpers for money, dates and fee status.

export const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

// 'YYYY-MM-DD' (date-only) -> local Date at midnight, so it never shifts a day with time zones.
export const parseDay = (s) => new Date(String(s).slice(0, 10) + 'T00:00:00');

// Local calendar day key ('YYYY-MM-DD') of any date / ISO timestamp.
export const dayKey = (d) => new Date(d).toLocaleDateString('en-CA');

export const fmtDay = (s, opts = { day: '2-digit', month: 'short', year: 'numeric' }) =>
  parseDay(s).toLocaleDateString('en-IN', opts);

export const fmtDateTime = (iso) =>
  new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

export function daysUntil(dueDate, now = new Date()) {
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  return Math.round((parseDay(dueDate) - today) / 86400000);
}

// 'paid' | 'overdue' | 'pending'  (overdue = unpaid and past its due date)
export const feeState = (fee, now) => (fee.status === 'paid' ? 'paid' : daysUntil(fee.due_date, now) < 0 ? 'overdue' : 'pending');

export function duration(fromIso, toIso) {
  if (!toIso) return null;
  const mins = Math.max(0, Math.round((new Date(toIso) - new Date(fromIso)) / 60000));
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
}

export const METHODS = { cash: 'Cash', upi: 'UPI', card: 'Card', bank_transfer: 'Bank transfer', other: 'Other' };
