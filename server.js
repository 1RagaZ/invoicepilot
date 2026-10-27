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

    // Create and send an invoice.
    if (req.method === 'POST' && url.pathname === '/api/invoices') {
      const { clientEmail, description, amount, currency } = await readBody(req);
      if (!clientEmail || !description || !amount) {
        return sendJson(res, 400, { error: 'clientEmail, description and amount are required.' });
      }
      const currencyCode = (currency || 'USD').toUpperCase();
      const token = await getToken();
      const created = await paypal('/v2/invoicing/invoices', token, 'POST', {
        detail: { currency_code: currencyCode },
        primary_recipients: [{ billing_info: { email_address: clientEmail } }],
        items: [{
          name: description,
          quantity: '1',
          unit_amount: { currency_code: currencyCode, value: Number(amount).toFixed(2) },
        }],
      });
      const sent = await paypal(`/v2/invoicing/invoices/${created.id}/send`, token, 'POST', {});
      return sendJson(res, 200, { id: created.id, status: sent.status || 'SENT' });
    }

    // Check an invoice's status.
    const statusMatch = url.pathname.match(/^\/api\/invoices\/([^/]+)$/);
    if (req.method === 'GET' && statusMatch) {
      const token = await getToken();
      const invoice = await paypal(`/v2/invoicing/invoices/${encodeURIComponent(statusMatch[1])}`, token, 'GET');
      return sendJson(res, 200, {
        id: invoice.id,
        status: invoice.status,
        amount: invoice.amount,
        dueDate: invoice.detail && invoice.detail.due_date ? invoice.detail.due_date : null,
      });
    }

    return sendJson(res, 404, { error: 'Not found.' });
  } catch (err) {
    return sendJson(res, err.status || 500, { error: err.message, details: err.details || undefined });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`InvoicePilot running on http://localhost:${PORT}`);
});
