// Fixture tests for overdue.js. No network, no AI key.
// The 8 cases come from milestone3-overdue-spec.md. Exit 1 on any failure.
const { checkOverdue } = require('./overdue');

const cases = [
  { n: 1, status: 'SENT', dueDate: '2026-11-01', today: '2026-11-02', want: { state: 'overdue', overdue: true, daysLate: 1 } },
  { n: 2, status: 'SENT', dueDate: '2026-11-02', today: '2026-11-02', want: { state: 'due_today', overdue: false, daysLate: 0 } },
  { n: 3, status: 'SENT', dueDate: '2026-11-05', today: '2026-11-02', want: { state: 'not_due', overdue: false, daysLate: 0 } },
  { n: 4, status: 'PAID', dueDate: '2026-10-20', today: '2026-11-02', want: { state: 'paid', overdue: false, daysLate: 0 } },
  { n: 5, status: 'SENT', dueDate: null, today: '2026-11-02', want: { state: 'due_date_unknown', overdue: false, daysLate: 0 } },
  { n: 6, status: 'SENT', dueDate: '2026-10-01', today: '2026-11-02', want: { state: 'overdue', overdue: true, daysLate: 32 } },
  { n: 7, status: 'SENT', dueDate: '2026-11-01', today: '2026-11-01', want: { state: 'due_today', overdue: false, daysLate: 0 } },
  { n: 8, status: 'CANCELLED', dueDate: '2026-10-01', today: '2026-11-02', want: { state: 'cancelled', overdue: false, daysLate: 0 } },
];

let failures = 0;
for (const c of cases) {
  const got = checkOverdue({ status: c.status, dueDate: c.dueDate }, c.today);
  const ok = got.state === c.want.state && got.overdue === c.want.overdue && got.daysLate === c.want.daysLate;
  console.log(`case ${c.n}: ${ok ? 'PASS' : 'FAIL'} (got ${got.state}, overdue=${got.overdue}, daysLate=${got.daysLate})`);
  if (!ok) failures += 1;
}
console.log(failures === 0 ? `all ${cases.length} overdue cases pass` : `${failures} case(s) failed`);
process.exit(failures === 0 ? 0 : 1);
