// InvoicePilot AI parser. One job: turn a plain-language job description
// into structured invoice fields. The model call is isolated so the provider
// is a configuration choice, not a rewrite.
//
// Configuration (from .env, never hardcoded):
//   AI_API_KEY   - key for the model provider
//   AI_API_BASE  - OpenAI-compatible chat completions endpoint, e.g.
//                  https://generativelanguage.googleapis.com/v1beta/openai
//   AI_MODEL     - model name, e.g. gemini-2.0-flash
//
// parseInvoice(text) returns:
//   { clientName, clientEmail, description, amount, currency, dueDays }
// clientEmail and dueDays may be null when the text does not give them.
// amount is a number greater than 0. currency defaults to USD.

const PROMPT = `You extract invoice fields from a freelancer's plain-language job description.
Return ONLY a JSON object, no other text, with exactly these keys:
- clientName: string or null (the client, person or business)
- clientEmail: string or null (only if an email address is stated)
- description: string (the work done, concise)
- amount: number greater than 0 (the total price; if a rate and quantity are given, multiply them)
- currency: 3-letter code, default "USD" unless another currency is stated
- dueDays: number or null (days until payment is due; "due in 14 days" is 14, "net 30" is 30, "due Friday" with no date given is null)

Job description:
`;

function validate(parsed) {
  if (!parsed || typeof parsed !== 'object') throw new Error('Parser returned no object.');
  if (!parsed.description || typeof parsed.description !== 'string') {
    throw new Error('Parser did not return a description.');
  }
  if (typeof parsed.amount !== 'number' || !(parsed.amount > 0)) {
    throw new Error('Parser did not return a positive amount.');
  }
  return {
    clientName: parsed.clientName || null,
    clientEmail: parsed.clientEmail || null,
    description: parsed.description,
    amount: parsed.amount,
    currency: (parsed.currency || 'USD').toUpperCase(),
    dueDays: typeof parsed.dueDays === 'number' ? parsed.dueDays : null,
  };
}

// Shared model call: one user prompt in, the model's raw text out.
function aiConfig() {
  const key = process.env.AI_API_KEY;
  const base = process.env.AI_API_BASE;
  const model = process.env.AI_MODEL;
  if (!key || !base || !model) {
    throw new Error('AI is not configured. Set AI_API_KEY, AI_API_BASE and AI_MODEL in .env.');
  }
  return { key, base, model };
}

async function callModel(prompt, fetchImpl) {
  const { key, base, model } = aiConfig();
  const doFetch = fetchImpl || fetch;
  // A hung model must fail fast (30s) instead of hanging the request: the
  // caller falls back to the template draft. Without this, a stalled Gemini
  // call left the draft endpoint hanging past 100s on 2026-11-07.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  let res;
  try {
    res = await doFetch(`${base.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err && err.name === 'AbortError') throw new Error('AI request timed out after 30s.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`AI request failed: ${res.status}`);
  const data = await res.json();
  const content = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : null;
  if (!content) throw new Error('AI returned no content.');
  return content;
}

const REMINDER_PROMPT = `You write a short payment reminder email for a freelancer.
Tone: polite, firm, specific. Name the exact amount, the currency, and how many
days late the payment is. Do not threaten, do not add fees, do not invent a new
due date. Keep it under 120 words.
Return ONLY a JSON object, no other text, with exactly these keys:
- subject: string (one line, includes the invoice number)
- note: string (the reminder body, plain text, no greeting placeholder)

Invoice:
`;

// draftReminder(input) returns { subject, note }.
// input: { invoiceId, clientName, amount, currency, daysLate }.
async function draftReminder(input, fetchImpl) {
  if (!input || !input.invoiceId) throw new Error('draftReminder needs an invoiceId.');
  if (typeof input.amount !== 'number' || !(input.amount > 0)) {
    throw new Error('draftReminder needs a positive amount.');
  }
  if (typeof input.daysLate !== 'number' || input.daysLate < 1) {
    throw new Error('draftReminder needs daysLate of at least 1.');
  }
  const facts = [
    `Invoice number: ${input.invoiceId}`,
    `Client: ${input.clientName || 'the client'}`,
    `Amount due: ${input.amount} ${String(input.currency || 'USD').toUpperCase()}`,
    `Days late: ${input.daysLate}`,
  ].join('\n');
  const content = await callModel(REMINDER_PROMPT + facts, fetchImpl);
  let draft;
  try {
    draft = JSON.parse(content);
  } catch {
    throw new Error('AI did not return a valid reminder draft.');
  }
  if (!draft || typeof draft.subject !== 'string' || !draft.subject.trim()
    || typeof draft.note !== 'string' || !draft.note.trim()) {
    throw new Error('AI returned an incomplete reminder draft.');
  }
  return { subject: draft.subject.trim().slice(0, 120), note: draft.note.trim().slice(0, 1000) };
}

// fetchImpl is injectable so tests can run without a live key.
// In production it defaults to global fetch.
async function parseInvoice(text, fetchImpl) {
  if (!text || !text.trim()) throw new Error('No job description given.');
  const content = await callModel(PROMPT + text, fetchImpl);
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('AI did not return valid JSON.');
  }
  return validate(parsed);
}

// Template parser: a deterministic fallback when the model is down. It only
// extracts what the text states plainly; anything it cannot find is null,
// and a missing amount is an error, never a guess. The caller labels the
// result 'template' so it is never presented as AI-written.
const WORD_NUMBERS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12,
};

function parseTemplate(text) {
  if (!text || !text.trim()) throw new Error('No job description given.');
  const t = text.trim();
  const lower = t.toLowerCase();

  // Client email, when stated.
  const emailMatch = t.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  const clientEmail = emailMatch ? emailMatch[0] : null;

  // Amount: a $ amount first, else a number with a currency word.
  // "N each" with a quantity multiplies the rate (e.g. "Three blog posts,
  // $75 each" is 3 x 75).
  let amount = null;
  let currency = 'USD';
  const dollar = t.match(/\$\s*(\d+(?:\.\d{1,2})?)/);
  const worded = t.match(/(\d+(?:\.\d{1,2})?)\s*(dollars?|usd|euros?|eur|pounds?|gbp|kes|ksh)/i);
  let rate = null;
  if (dollar) {
    rate = Number(dollar[1]);
    currency = 'USD';
  } else if (worded) {
    rate = Number(worded[1]);
    const word = worded[2].toLowerCase();
    if (word.startsWith('eur')) currency = 'EUR';
    else if (word.startsWith('pound') || word === 'gbp') currency = 'GBP';
    else if (word === 'kes' || word === 'ksh') currency = 'KES';
    else currency = 'USD';
  }
  if (rate != null) {
    amount = rate;
    if (/\beach\b/i.test(t)) {
      const qtyWord = lower.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/);
      const qtyDigit = t.match(/(\d+)\s+\w+\s+for\b/);
      const qty = qtyWord ? WORD_NUMBERS[qtyWord[1]] : (qtyDigit ? Number(qtyDigit[1]) : null);
      if (qty) amount = rate * qty;
    }
    if (t.includes('€')) currency = 'EUR';
    if (t.includes('£')) currency = 'GBP';
  }
  if (amount == null || !(amount > 0)) {
    throw new Error('Template could not find an amount.');
  }

  // Due days: "due in N days", "net N", "pay within N days", "due in N weeks".
  let dueDays = null;
  const dueIn = lower.match(/due in (\d+)\s*(day|week)/);
  const net = lower.match(/net (\d+)/);
  const within = lower.match(/pay within (\d+)\s*day/);
  if (dueIn) dueDays = Number(dueIn[1]) * (dueIn[2] === 'week' ? 7 : 1);
  else if (net) dueDays = Number(net[1]);
  else if (within) dueDays = Number(within[1]);

  // Client: the words after "for", up to a comma or a due/pay phrase.
  // An email there is a clientEmail, not a clientName.
  let clientName = null;
  const forMatch = t.match(/ for (.+)$/i);
  if (forMatch) {
    let segment = forMatch[1].split(',')[0].trim();
    segment = segment.split(/\b(?:due|pay|net)\b/i)[0].trim();
    if (segment && !segment.includes('@')) clientName = segment;
  }

  // Description: the work, which is the text before "for". Without "for",
  // the text with the amount and due phrases stripped.
  let description = '';
  const forIdx = lower.indexOf(' for ');
  if (forIdx >= 0) description = t.slice(0, forIdx).trim();
  else {
    description = t
      .replace(/\$\s*\d+(?:\.\d{1,2})?/g, '')
      .replace(/\b\d+(?:\.\d{1,2})?\s*(dollars?|usd|euros?|eur|pounds?|gbp|kes|ksh)\b/gi, '')
      .replace(/\b(due in \d+ \w+|net \d+|pay within \d+ \w+|due end of month)\b/gi, '')
      .replace(/,+/g, ',').trim();
  }
  if (!description) description = t;

  return validate({
    clientName,
    clientEmail,
    description,
    amount,
    currency,
    dueDays,
  });
}

module.exports = { parseInvoice, parseTemplate, validate, draftReminder, callModel };
