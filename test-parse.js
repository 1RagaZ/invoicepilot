// Tests for ai.js. No live key needed: the model is stubbed.
// What this proves: wiring, JSON handling, and field validation.
// What it does NOT prove: model accuracy. That needs a live run of the
// five acceptance cases below once AI_API_KEY, AI_API_BASE and AI_MODEL
// are set. Those five cases are the Milestone 2 acceptance test.

// Five acceptance cases (Milestone 2: correct client, amount, due date).
// Each entry states what a correct model answer must contain.
const ACCEPTANCE_CASES = [
  {
    text: 'Logo design for Acme, $400, due in 14 days',
    expect: { clientName: 'Acme', amount: 400, dueDays: 14 },
  },
  {
    text: 'Built a landing page for Jane at Bright Studio, 800 dollars, net 30',
    expect: { clientName: 'Bright Studio', amount: 800, dueDays: 30 },
  },
  {
    text: 'Three blog posts for Kofi, $75 each, pay within 7 days',
    expect: { clientName: 'Kofi', amount: 225, dueDays: 7 },
  },
  {
    text: 'Video edit for maria@example.com, 1200 USD, due in 21 days',
    expect: { clientEmail: 'maria@example.com', amount: 1200, dueDays: 21 },
  },
  {
    text: 'Consulting for Delta Ltd, 500 euros, due end of month',
    expect: { clientName: 'Delta Ltd', amount: 500, currency: 'EUR' },
  },
];

const { parseInvoice, validate } = require('./ai.js');

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`PASS: ${name}`); }
  else { failed++; console.log(`FAIL: ${name}`); }
}

async function main() {
  // validate(): good output passes through normalized.
  const good = validate({
    clientName: 'Acme', clientEmail: null, description: 'Logo design',
    amount: 400, currency: 'usd', dueDays: 14,
  });
  check('validate normalizes currency to USD', good.currency === 'USD');
  check('validate keeps amount and dueDays', good.amount === 400 && good.dueDays === 14);

  // validate(): bad outputs rejected.
  for (const [name, bad] of [
    ['rejects missing description', { amount: 10 }],
    ['rejects zero amount', { description: 'x', amount: 0 }],
    ['rejects negative amount', { description: 'x', amount: -5 }],
    ['rejects non-object', null],
  ]) {
    let threw = false;
    try { validate(bad); } catch { threw = true; }
    check(name, threw);
  }

  // parseInvoice(): stub model returning valid JSON.
  const stubFetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify({
        clientName: 'Acme', clientEmail: null, description: 'Logo design',
        amount: 400, currency: 'USD', dueDays: 14,
      }) } }],
    }),
  });
  process.env.AI_API_KEY = 'test-key';
  process.env.AI_API_BASE = 'https://example.invalid';
  process.env.AI_MODEL = 'test-model';
  const parsed = await parseInvoice('Logo design for Acme, $400, due in 14 days', stubFetch);
  check('parseInvoice returns stub model output', parsed.amount === 400 && parsed.clientName === 'Acme');

  // parseInvoice(): stub model returning invalid JSON.
  const badJsonFetch = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: 'not json' } }] }),
  });
  let threw = false;
  try { await parseInvoice('anything', badJsonFetch); } catch { threw = true; }
  check('parseInvoice rejects non-JSON model output', threw);

  // parseInvoice(): missing config.
  delete process.env.AI_API_KEY;
  threw = false;
  try { await parseInvoice('anything', stubFetch); } catch (e) { threw = /not configured/.test(e.message); }
  check('parseInvoice reports missing config cleanly', threw);

  // Acceptance cases are documented here for the live run.
  console.log(`\nAcceptance cases awaiting a live model run: ${ACCEPTANCE_CASES.length}`);
  for (const c of ACCEPTANCE_CASES) console.log(` - ${c.text}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
