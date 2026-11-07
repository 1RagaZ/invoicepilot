// InvoicePilot overdue detection. Pure logic, no network, no AI.
// Rule (approved 2026-11-07 by Alfred on Jackson's delegation; spec as written):
// an invoice is OVERDUE only when ALL hold:
//   1. status is SENT (an unpaid, sent invoice),
//   2. dueDate is present,
//   3. today's EAT calendar date is strictly after dueDate.
// daysLate is whole days between dueDate and today (EAT).
// Never overdue: PAID and any cancelled/refunded status.
// dueDate missing -> 'due_date_unknown', never flagged overdue.

function todayEAT(date) {
  const d = date || new Date();
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d); // YYYY-MM-DD
}

function wholeDays(fromYMD, toYMD) {
  const ms = Date.parse(toYMD + 'T00:00:00Z') - Date.parse(fromYMD + 'T00:00:00Z');
  return Math.round(ms / 86400000);
}

function checkOverdue(invoice, today) {
  const status = (invoice && invoice.status) || null;
  const dueDate = (invoice && invoice.dueDate) || null;
  const todayYMD = today || todayEAT();
  if (status === 'PAID') return { state: 'paid', overdue: false, daysLate: 0, dueDate, today: todayYMD };
  if (status === 'CANCELLED' || status === 'REFUNDED') {
    return { state: 'cancelled', overdue: false, daysLate: 0, dueDate, today: todayYMD };
  }
  if (!dueDate) return { state: 'due_date_unknown', overdue: false, daysLate: 0, dueDate: null, today: todayYMD };
  if (status !== 'SENT') {
    return { state: 'unconfirmed_status', overdue: false, daysLate: 0, dueDate, today: todayYMD };
  }
  const daysLate = wholeDays(dueDate, todayYMD);
  if (daysLate <= 0) {
    return {
      state: daysLate === 0 ? 'due_today' : 'not_due',
      overdue: false,
      daysLate: 0,
      dueDate,
      today: todayYMD,
    };
  }
  return { state: 'overdue', overdue: true, daysLate, dueDate, today: todayYMD };
}

module.exports = { checkOverdue, todayEAT, wholeDays };
