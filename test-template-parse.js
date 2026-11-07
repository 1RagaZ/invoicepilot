// Tests for the template parser (ai.js parseTemplate). No live key needed.
// What this proves: the fallback extracts the five Milestone 2 acceptance
// cases deterministically when the model is down.
// What it does NOT prove: model accuracy, or parsing of phrasings outside
// these patterns. Anything it cannot parse is an error, never a guess.

// The five Milestone 2 acceptance cases. Case 2's client is "Jane at Bright
// Studio" here: the plan's own note calls that answer still correct, and
// the template takes the words after "for" as stated.
const CASES = [
  {
    text: 'Logo design for Acme, $400, due in 14 days',
    expect: { clientName: 'Acme', amount: 400, dueDays: 14 },
  },
  {
    text: 'Built a landing page for Jane at Bright Studio, 800 dollars, net 30',
    expect: { clientName: 'Jane at Bright Studio', amount: 800, dueDays: 30 },
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
    expect: { clientName: 'Delta Ltd', amount: 500, currency: 'EUR', dueDays: null },
  },
];

const { parseTemplate } = require('./ai.js');

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`PASS: ${name}`); }
  else { failed++; console.log(`FAIL: ${name}`); }
}

async function main() {
  for (const c of CASES) {
    const got = parseTemplate(c.text);
    const e = c.expect;
    check(`"${c.text.slice(0, 30)}..." amount ${e.amount}`, got.amount === e.amount);
    if (e.clientName !== undefined) {
      check(`"${c.text.slice(0, 30)}..." client ${e.clientName}`, got.clientName === e.clientName);
    }
    if (e.clientEmail !== undefined) {
      check(`"${c.text.slice(0, 30)}..." email ${e.clientEmail}`, got.clientEmail === e.clientEmail);
    }
    if (e.dueDays !== undefined) {
      check(`"${c.text.slice(0, 30)}..." dueDays ${e.dueDays}`, got.dueDays === e.dueDays);
    }
    if (e.currency !== undefined) {
      check(`"${c.text.slice(0, 30)}..." currency ${e.currency}`, got.currency === e.currency);
    }
  }

  // A description with no amount is an error, never a guessed amount.
  let threw = false;
  try { parseTemplate('Logo design for Acme, due in 14 days'); } catch { threw = true; }
  check('no amount is an error, not a guess', threw);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main();
