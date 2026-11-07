# InvoicePilot

An AI invoicing agent for freelancers, built for the PayPal AI Hackathon 2026.
Target: Best Use of Agentic Commerce.

Describe a job in plain language. InvoicePilot parses it into an invoice,
sends it through PayPal, tracks whether it is paid, and chases late payers:
it detects overdue invoices, drafts a reminder, and sends it only after you
approve it with one click.

## The agent loop

1. **Parse** — plain language in, invoice fields out (client, description,
   amount, currency, due date), via an OpenAI-compatible AI model.
2. **Create and send** — PayPal Invoicing API v2 (sandbox), create + send.
3. **Detect** — an invoice is overdue only when it is SENT, has a due date,
   and today's date is strictly after that due date. PAID and cancelled
   invoices are never flagged; a missing due date is reported, never guessed.
4. **Draft** — a reminder is drafted by the AI first. If the model is down,
   a plain template draft stands in, and the response says which it is
   (`source: "ai"` or `"template"`). A template draft is never presented as
   AI-written.
5. **Approve and send** — the draft is stored and shown. Nothing sends
   without one click of approval. Approval calls PayPal's send-reminder
   endpoint, and every send is logged.

## Status

Milestones 1–3 done and verified live against the PayPal sandbox (2026-11-07):
invoice create + send + status, overdue detection, AI/template reminder
drafting, approval-gated sending with a send log. Test suites: overdue 8/8,
reminder drafting 4/4, parse 9/9 (`npm test`).

Known limits: the AI draft leg depends on the model being up (Gemini 3.8
Flash was returning 503 on 2026-11-07; the template fallback keeps the loop
working). Drafts persist on disk across restarts. There is no auth on the
API routes — this is a sandbox demo, not a production service.

## Setup

Stack: Node 18+ server, zero dependencies. No build step.

1. Copy `.env.example` to `.env` and fill in your own PayPal sandbox
   credentials and AI API key. Never commit `.env`.
2. Run `node server.js` and open http://localhost:3000.
3. Describe the job, check the parsed invoice, send it. Check its status by
   invoice ID, and use the reminders section for overdue invoices.

## API

- `POST /api/parse` — `{ text }` → invoice fields.
- `POST /api/invoices` — `{ clientEmail, description, amount, currency?, dueDate? }` → creates and sends the invoice. `dueDate` is `YYYY-MM-DD`.
- `GET /api/invoices/:id` — status, amount, due date, and the overdue assessment.
- `POST /api/invoices/:id/reminders/draft` — drafts a reminder for an overdue invoice. Sends nothing.
- `POST /api/invoices/:id/reminders/:draftId/approve` — the only call that sends a reminder.
- `GET /api/invoices/:id/reminders` — drafts and the send log for one invoice.

## License

MIT. See `LICENSE`.
