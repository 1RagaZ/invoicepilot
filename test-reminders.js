// Tests for draftReminder with an injected fake model response. No live key.
// The fetch is injected, but the config check still runs, so dummy values stand in.
process.env.AI_API_KEY = 'test-key';
process.env.AI_API_BASE = 'https://example.invalid/v1';
process.env.AI_MODEL = 'test-model';

const { draftReminder } = require('./ai');

function fakeFetch(reply) {
  return async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: reply } }] }),
  });
}

async function run() {
  let failures = 0;
  const ok = (name, cond) => {
    console.log(`${name}: ${cond ? 'PASS' : 'FAIL'}`);
    if (!cond) failures += 1;
  };

  const draft = await draftReminder(
    { invoiceId: 'INV2-TEST', clientName: 'Acme Ltd', amount: 500, currency: 'USD', daysLate: 6 },
    fakeFetch(JSON.stringify({
      subject: 'Reminder: Payment due for invoice INV2-TEST',
      note: 'Hello Acme Ltd, your payment of 500 USD is 6 days late. Please pay at your earliest convenience.',
    })),
  );
  ok('draft subject names the invoice', draft.subject.includes('INV2-TEST'));
  ok('draft note names amount and days late', draft.note.includes('500') && draft.note.includes('6 days'));

  try {
    await draftReminder({ invoiceId: 'INV2-TEST', amount: 500, daysLate: 0 }, fakeFetch('{}'));
    ok('draft refuses daysLate 0', false);
  } catch (e) {
    ok('draft refuses daysLate 0', /daysLate/.test(e.message));
  }

  try {
    await draftReminder(
      { invoiceId: 'INV2-TEST', amount: 500, daysLate: 3 },
      fakeFetch('not json'),
    );
    ok('draft refuses non-JSON reply', false);
  } catch (e) {
    ok('draft refuses non-JSON reply', /valid reminder draft/.test(e.message));
  }

  console.log(failures === 0 ? 'all reminder draft cases pass' : `${failures} case(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
