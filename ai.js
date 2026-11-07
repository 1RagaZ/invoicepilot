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

module.exports = { parseInvoice, validate, draftReminder, callModel };
