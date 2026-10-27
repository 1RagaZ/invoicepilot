# InvoicePilot

An AI invoicing agent for freelancers, built for the PayPal AI Hackathon 2026.

Describe a job in plain language. InvoicePilot drafts the invoice, sends it
through PayPal, tracks who has paid, and chases late payers with AI-written
reminders that send only on your approval.

## Status

Milestone 1 in progress. PayPal sandbox app created (BillPilot).

## Setup

Stack: Node 18+ server, zero dependencies. No build step.

1. Copy `.env.example` to `.env` and fill in your own PayPal sandbox
   credentials and AI API key. Never commit `.env`.
2. Run `node server.js` and open http://localhost:3000.
3. The form sends a PayPal sandbox invoice (create + send) and can check
   its status by invoice ID.

## License

MIT. See `LICENSE`.
