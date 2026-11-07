// InvoicePilot server. Zero dependencies, Node 18+.
// PayPal sandbox Invoicing API v2: create an invoice, send it, check its status.
// Credentials come only from .env (never committed, see .gitignore).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

// Minimal .env loader (no dependency).
function loadEnv(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return env;
}

const env = loadEnv(path.join(__dirname, '.env'));
const API_BASE = (env.PAYPAL_API_BASE || 'https://api-m.sandbox.paypal.com').replace(/\/$/, '');

// Bridge .env values into process.env so ai.js can read them.
for (const k of ['AI_API_KEY', 'AI_API_BASE', 'AI_MODEL']) {
  if (env[k] && !process.env[k]) process.env[k] = env[k];
}
const { parseInvoice, draftReminder } = require('./ai.js');
const { checkOverdue } = require('./overdue');
const crypto = require('node:crypto');

// Reminder drafts live in reminders_drafts.json on disk (loaded at startup),
// not in memory: a restart between draft and approve must not lose the draft.
// Nothing is ever sent without an explicit approve call. Every send is
// appended to reminders_log.json (gitignored) with its draft id and time.
const DRAFTS_FILE = path.join(__dirname, 'reminders_drafts.json');

function readDraftsFile() {
  if (!fs.existsSync(DRAFTS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(DRAFTS_FILE, 'utf8')); } catch { return {}; }
}

function writeDraftsFile(draftsObj) {
  fs.writeFileSync(DRAFTS_FILE, JSON.stringify(draftsObj, null, 2));
}

const drafts = new Map(Object.entries(readDraftsFile()));
const LOG_FILE = path.join(__dirname, 'reminders_log.json');

function saveDraft(draft) {
  drafts.set(draft.draftId, draft);
  writeDraftsFile(Object.fromEntries(drafts));
}

function logReminder(entry) {
  const line = JSON.stringify({ ...entry, loggedAt: new Date().toISOString() }) + '\n';
  fs.appendFileSync(LOG_FILE, line);
}

function readReminderLog() {
  if (!fs.existsSync(LOG_FILE)) return [];
  return fs.readFileSync(LOG_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

async function loadInvoice(token, invoiceId) {
  const invoice = await paypal(`/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}`, token, 'GET');
  const paymentTerm = invoice.detail && invoice.detail.payment_term ? invoice.detail.payment_term : null;
  return {
    id: invoice.id,
    status: invoice.status,
    amount: invoice.amount,
    dueDate: paymentTerm && paymentTerm.due_date
      ? paymentTerm.due_date
      : (invoice.detail && invoice.detail.due_date ? invoice.detail.due_date : null),
    clientName: invoice.primary_recipients && invoice.primary_recipients[0]
      && invoice.primary_recipients[0].billing_info
      ? invoice.primary_recipients[0].billing_info.name || null : null,
    description: invoice.items && invoice.items[0] ? invoice.items[0].description || null : null,
  };
}

function needCreds() {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
    const err = new Error('PayPal sandbox credentials missing. Copy .env.example to .env and fill in your own values.');
    err.status = 500;
    throw err;
  }
}

async function getToken() {
  needCreds();
  const creds = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    const err = new Error(`PayPal token request failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return (await res.json()).access_token;
}

async function paypal(pathname, token, method = 'GET', body) {
  const res = await fetch(`${API_BASE}${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error((data && data.message) || `PayPal request failed: ${res.status}`);
    err.status = res.status;
    err.details = data;
    throw err;
  }
  return data;
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');

    // Static frontend.
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': html.length });
      return res.end(html);
    }

    // Self-hosted fonts (public/fonts/*.woff2, written by the awwwards font helper).
    const fontMatch = url.pathname.match(/^\/fonts\/([A-Za-z0-9._-]+\.woff2)$/);
    if (req.method === 'GET' && fontMatch) {
      const fontPath = path.join(__dirname, 'public', 'fonts', fontMatch[1]);
      if (!fs.existsSync(fontPath)) return sendJson(res, 404, { error: 'Not found.' });
      const font = fs.readFileSync(fontPath);
      res.writeHead(200, { 'Content-Type': 'font/woff2', 'Content-Length': font.length, 'Cache-Control': 'public, max-age=31536000' });
      return res.end(font);
    }

    // Favicon, OG image, robots, sitemap: small public files.
    const publicFile = (name, type) => {
      const f = path.join(__dirname, 'public', name);
      if (!fs.existsSync(f)) return false;
      const body = fs.readFileSync(f);
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': 'public, max-age=3600' });
      res.end(body);
      return true;
    };
    if (req.method === 'GET' && url.pathname === '/favicon.svg') return publicFile('favicon.svg', 'image/svg+xml') || sendJson(res, 404, { error: 'Not found.' });
    if (req.method === 'GET' && url.pathname === '/favicon.ico') return publicFile('favicon.svg', 'image/svg+xml') || sendJson(res, 404, { error: 'Not found.' });
    if (req.method === 'GET' && url.pathname === '/og.png') return publicFile('og.png', 'image/png') || sendJson(res, 404, { error: 'Not found.' });
    if (req.method === 'GET' && url.pathname === '/robots.txt') {
      const body = 'User-agent: *\nAllow: /\n';
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': body.length });
      return res.end(body);
    }
    if (req.method === 'GET' && url.pathname === '/sitemap.xml') {
      const body = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n<url><loc>/</loc></url>\n</urlset>\n';
      res.writeHead(200, { 'Content-Type': 'application/xml', 'Content-Length': body.length });
      return res.end(body);
    }

    // Create and send an invoice. Optional dueDate (YYYY-MM-DD) sets the
    // invoice due date; without it PayPal leaves the due date unset.
    if (req.method === 'POST' && url.pathname === '/api/invoices') {
      const { clientEmail, description, amount, currency, dueDate } = await readBody(req);
      if (!clientEmail || !description || !amount) {
        return sendJson(res, 400, { error: 'clientEmail, description and amount are required.' });
      }
      const currencyCode = (currency || 'USD').toUpperCase();
      const token = await getToken();
      const detail = { currency_code: currencyCode };
      // Due date lives at detail.payment_term.due_date (PayPal API reference,
      // create invoice example). DUE_ON_DATE_SPECIFIED pairs with an explicit date.
      if (dueDate) detail.payment_term = { term_type: 'DUE_ON_DATE_SPECIFIED', due_date: dueDate };
      const created = await paypal('/v2/invoicing/invoices', token, 'POST', {
        detail,
        primary_recipients: [{ billing_info: { email_address: clientEmail } }],
        items: [{
          name: description,
          quantity: '1',
          unit_amount: { currency_code: currencyCode, value: Number(amount).toFixed(2) },
        }],
      });
      // PayPal create returns only a self link, e.g.
      // { rel: 'self', href: 'https://api.sandbox.paypal.com/v2/invoicing/invoices/INV2-...', method: 'GET' }.
      // The invoice id is the last path segment of that href; there is no `id` field.
      const invoiceId = created.id || (typeof created.href === 'string' ? created.href.split('/').filter(Boolean).pop() : null);
      if (!invoiceId) throw new Error('PayPal create returned no invoice id.');
      const sent = await paypal(`/v2/invoicing/invoices/${invoiceId}/send`, token, 'POST', {});
      return sendJson(res, 200, { id: invoiceId, status: sent.status || 'SENT' });
    }

    // Check an invoice's status, with its overdue assessment.
    const statusMatch = url.pathname.match(/^\/api\/invoices\/([^/]+)$/);
    if (req.method === 'GET' && statusMatch) {
      const token = await getToken();
      const invoice = await loadInvoice(token, statusMatch[1]);
      return sendJson(res, 200, { ...invoice, overdue: checkOverdue(invoice) });
    }

    // Draft a payment reminder for an overdue invoice. The draft is stored
    // and returned; nothing is sent by this call.
    // AI first; if the model is down (Gemini 503 since 2026-11-07 ~09:45 EAT),
    // a deterministic template draft stands in so the loop still works. The
    // response says which one it is (source: 'ai' | 'template') and a template
    // draft is never presented as AI-written.
    const draftMatch = url.pathname.match(/^\/api\/invoices\/([^/]+)\/reminders\/draft$/);
    if (req.method === 'POST' && draftMatch) {
      const token = await getToken();
      const invoice = await loadInvoice(token, draftMatch[1]);
      const overdue = checkOverdue(invoice);
      if (!overdue.overdue) {
        return sendJson(res, 409, { error: `Invoice is not overdue (state: ${overdue.state}).`, overdue });
      }
      const amountValue = invoice.amount && invoice.amount.value ? Number(invoice.amount.value) : null;
      if (!amountValue) return sendJson(res, 409, { error: 'Invoice has no amount to remind about.' });
      const currencyCode = invoice.amount.currency_code || 'USD';
      let draft;
      let source = 'ai';
      try {
        draft = await draftReminder({
          invoiceId: invoice.id,
          clientName: invoice.clientName,
          amount: amountValue,
          currency: currencyCode,
          daysLate: overdue.daysLate,
        });
      } catch (err) {
        // Logged server-side so a config failure is never mistaken for a
        // model outage; the caller still gets a working template draft.
        console.error(`AI draft failed for ${invoice.id}: ${err.message}`);
        source = 'template';
        draft = {
          subject: `Reminder: Payment due for invoice ${invoice.id}`,
          note: `Hello ${invoice.clientName || 'there'},\n\nYour payment of ${amountValue.toFixed(2)} ${currencyCode} for invoice ${invoice.id} is ${overdue.daysLate} day${overdue.daysLate === 1 ? '' : 's'} past its due date. Please pay at your earliest convenience.\n\nThank you,\nInvoicePilot`,
        };
      }
      const draftId = crypto.randomUUID();
      const stored = {
        draftId, invoiceId: invoice.id, ...draft, daysLate: overdue.daysLate, status: 'draft', source,
      };
      saveDraft(stored);
      return sendJson(res, 200, stored);
    }

    // Approve a stored draft: this is the only call that sends a reminder.
    // PayPal allows 2 reminder sends per invoice per day; a second approve
    // of the same draft is refused.
    const approveMatch = url.pathname.match(/^\/api\/invoices\/([^/]+)\/reminders\/([^/]+)\/approve$/);
    if (req.method === 'POST' && approveMatch) {
      const draft = drafts.get(approveMatch[2]);
      if (!draft || draft.invoiceId !== approveMatch[1]) {
        return sendJson(res, 404, { error: 'Draft not found for this invoice.' });
      }
      if (draft.status === 'sent') {
        return sendJson(res, 409, { error: 'This draft was already sent.' });
      }
      const token = await getToken();
      await paypal(`/v2/invoicing/invoices/${encodeURIComponent(draft.invoiceId)}/remind`, token, 'POST', {
        subject: draft.subject,
        note: draft.note,
        send_to_recipient: true,
      });
      draft.status = 'sent';
      saveDraft(draft);
      logReminder({ draftId: draft.draftId, invoiceId: draft.invoiceId, subject: draft.subject, daysLate: draft.daysLate, source: draft.source || 'ai', sent: true });
      return sendJson(res, 200, { draftId: draft.draftId, invoiceId: draft.invoiceId, status: 'sent' });
    }

    // List drafts and the send log for one invoice.
    const listMatch = url.pathname.match(/^\/api\/invoices\/([^/]+)\/reminders$/);
    if (req.method === 'GET' && listMatch) {
      const invoiceId = listMatch[1];
      const mine = [...drafts.values()].filter((d) => d.invoiceId === invoiceId);
      const sent = readReminderLog().filter((e) => e.invoiceId === invoiceId);
      return sendJson(res, 200, { invoiceId, drafts: mine, sent });
    }

    // Parse a plain-language job description into invoice fields.
    if (req.method === 'POST' && url.pathname === '/api/parse') {
      const { text } = await readBody(req);
      if (!text) return sendJson(res, 400, { error: 'text is required.' });
      const parsed = await parseInvoice(text);
      return sendJson(res, 200, parsed);
    }

    // Unknown route. API calls get JSON; a browser gets the ledger's 404 page.
    if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found.' });
    const notFound = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
      + '<meta name="viewport" content="width=device-width, initial-scale=1">'
      + '<title>Not in the ledger - InvoicePilot</title>'
      + '<style>body{margin:0;background:#f7f5f0;color:#141414;font-family:system-ui,sans-serif}'
      + '.w{max-width:1200px;margin:0 auto;padding:0 24px 72px}'
      + 'header{display:grid;grid-template-columns:1fr auto;gap:4px 16px;padding:20px 0 16px;border-bottom:1px solid #141414}'
      + '.brand{font-weight:800;font-size:22px;letter-spacing:-.03em}.brand em{font-style:normal;color:#b42318}'
      + '.corner{font-size:13px;color:#5c5c55;text-align:right}.corner.l{text-align:left}'
      + '.jump{grid-column:1/-1;display:flex;gap:20px;justify-content:flex-end;padding-top:10px;font-size:13px}'
      + '.jump a{color:#5c5c55;text-decoration:none;padding:4px 2px}.jump a:hover{color:#141414;text-decoration:underline}'
      + 'main{padding:72px 0 56px}'
      + 'h1{font-size:44px;letter-spacing:-.03em;line-height:1;margin:0 0 16px}'
      + 'p{color:#5c5c55;margin:0 0 24px}'
      + '.ledger{border-top:1px solid #141414;margin:0 0 32px}'
      + '.lrow{display:grid;grid-template-columns:210px 1fr 120px;gap:16px;align-items:baseline;padding:16px 0;border-bottom:1px solid #ddd8cc}'
      + '.lrow .id{font-family:ui-monospace,monospace;font-size:14px;color:#5c5c55}'
      + '.lrow .desc{font-weight:600;color:#5c5c55}'
      + '.stamp{justify-self:center;align-self:center;transform:rotate(-8deg);border:2px solid #b42318;color:#b42318;border-radius:2px;font-weight:800;font-size:13px;letter-spacing:.08em;text-transform:uppercase;padding:3px 8px;white-space:nowrap}'
      + 'a.btn{display:inline-block;background:#141414;color:#fff;border:1px solid #141414;border-radius:2px;padding:11px 18px;font-size:15px;font-weight:700;text-decoration:none;min-height:44px;line-height:22px}'
      + 'a.btn:hover{background:#fbfaf7;color:#141414}'
      + 'footer{padding:64px 0 8px}.statement{font-size:clamp(2rem,5vw,3.5rem);font-weight:800;letter-spacing:-.03em;line-height:1.02;margin:0 0 32px;max-width:16ch}'
      + '.cols{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;border-top:1px solid #141414;padding-top:16px}.fine{font-size:13px;color:#5c5c55}.fine a{color:#141414;display:inline-block;padding:4px 0}</style></head><body>'
      + '<div class="w"><header><div class="brand">Invoice<em>Pilot</em></div>'
      + '<div class="corner">PayPal AI Hackathon 2026</div>'
      + '<div class="corner l">Sandbox demo</div>'
      + '<div class="corner">No real money moves</div>'
      + '<nav class="jump" aria-label="Sections"><a href="/#ledger">Ledger</a><a href="/#bench">Workbench</a></nav></header>'
      + '<main><h1>This entry is not in the ledger.</h1>'
      + '<p>The page you asked for does not exist. The ledger only holds invoices.</p>'
      + '<div class="ledger"><div class="lrow"><span class="id">—</span><span class="desc">No such entry</span><span class="stamp">Not found</span></div></div>'
      + '<a class="btn" href="/">Back to the ledger</a></main>'
      + '<footer><p class="statement">Nothing sends without your say-so.</p>'
      + '<div class="cols"><span class="fine">InvoicePilot · PayPal AI Hackathon 2026 · Sandbox demo</span>'
      + '<span class="fine"><a href="https://github.com/1RagaZ/invoicepilot">Source on GitHub</a></span></div></footer>'
      + '</div></body></html>';
    res.writeHead(404, { 'Content-Type': 'text/html', 'Content-Length': Buffer.byteLength(notFound) });
    return res.end(notFound);
  } catch (err) {
    return sendJson(res, err.status || 500, { error: err.message, details: err.details || undefined });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`InvoicePilot running on http://localhost:${PORT}`);
});
