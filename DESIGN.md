# InvoicePilot — DESIGN.md

Skill: juliobsz/skills, /awwwards (installed in ~/workspace/custom-skills/awwwards).
QA: /jury in ~/workspace/custom-skills/jury. Stack: the project's own — plain
HTML/CSS/JS served by the zero-dependency Node server. No Next.js, no GSAP,
no Lenis: the demo must run from one file with no build step.

## Brief (Phase 0)

- Subject: InvoicePilot, an AI invoicing agent for freelancers. PayPal AI
  Hackathon 2026, target Best Use of Agentic Commerce.
- Audience: hackathon judges, then freelancers. The site's job: prove the
  agent loop works (parse, send, detect overdue, draft, approve) and let a
  visitor run it.
- Assets: none provided. No photos, no logos. Everything on the page is type,
  rules and the live data of the demo itself.
- Assumptions: the visitor has never seen the product. The demo runs against
  the PayPal sandbox, so no real money moves; the page says so.

## Concept (Phase 1)

Three concepts, scored Originality / Fit / Feasibility / Portability
(portability lower is better):

- A. Flight deck (name). "Pilot" steers: the site is a cockpit, invoices are
  flights, SENT is airborne, PAID is landed, OVERDUE is holding. O4 F4 Fe3 P3.
  Charming, but flight is a common SaaS metaphor and it is not the product.
- B. Ledger and stamp (material). The site is a paper ledger. Every invoice
  is a ruled entry in tabular mono figures. When one goes overdue, a red
  PAST DUE stamp lands on it. O4 F5 Fe5 P2. Strongest fit: the invoice is the
  product's core object and the overdue stamp is its core moment. Cheapest
  to build. Hardest to move to another product.
- C. Assembly line (process). The invoice travels four stations (parse, send,
  detect, approve) and gets stamped at each. O3 F4 Fe3 P3. The loop is real,
  but a process line is generic.

Picked B. Steal from the formal idea that the page is one invoice: the hero
shows a real invoice, not a picture of one.

Concept Card:

```
Idea:        The site is a ledger book. Invoices are ruled entries; when one
             goes overdue, a red PAST DUE stamp lands on it.
Metaphor:    A paper ledger and a rubber stamp.
Signature:   The stamp. It lands on the overdue row with a small thud and
             stays. The reminder draft is written in the stamp's ink.
Emotion:     Opening a tidy ledger where one entry is circled in red. Calm,
             exact, one thing demanding attention.
Motion verb: Stamp and settle. Things land flat and stop dead. No bounce,
             no float, no drift.
Screenshot:  The ledger with the red PAST DUE stamp across the overdue row.
```

## Art direction system (Phase 2)

- Palette (by role):
  - ground: #f7f5f0 (ledger paper)
  - ink: #141414
  - muted: #5c5c55 (secondary text, AA on ground)
  - line: #ddd8cc (ruled lines)
  - accent: #b42318 (the stamp red, reserved for overdue only)
  - paid: #027a48 (paid only)
  - curtain: #141414
- Type:
  - Display + text: Archivo, one family, two personalities. Expanded 800
    for the wordmark and the hero statement, 400 normal width for body and
    UI. Source: Google Fonts (self-host with font.mjs if it downloads, else
    the Google Fonts link with a system fallback).
  - Accent: IBM Plex Mono for data — invoice IDs, amounts, dates, days late.
    Tabular figures everywhere a number appears.
  - Scale: hero clamp(3rem, 9vw, 6.5rem), line-height 0.95, tracking -0.04em.
    Section titles 28px. Body 17px/1.55. Small UI 13px.
- Grid & rhythm: 12 columns, gutter 24px. Two strong vertical lines: the
  ledger rule at col 1 and the figures column at col 9. Sections use different
  layout families: poster hero, index-list ledger, asymmetric pair for the
  workbench (form 7 cols, explainer 4 cols offset), statement footer.
- Shape: one radius rule — 2px everywhere (paper, not plastic). No soft
  shadows. Borders are 1px rules.
- Motion language: one ease (cubic-bezier(0.22, 1, 0.36, 1)), durations
  120–240ms. The stamp: scale 1.6 to 1 with opacity 0 to 1 in 140ms, then
  dead stop. Buttons press to scale 0.97. Ruled lines draw left to right on
  reveal. Reduced motion: everything still, fully visible.
- Still at rest, by decision: the page does not move while the visitor does
  nothing. The stamp is the only motion and it happens on a state change (an
  invoice going overdue), never as idle decoration. A quiet ledger stays
  still; the red stamp is the moment, and it only lands when it is earned.
- Composition plan:
  - Header: four-corner frame. Brand top-left, hackathon top-right, sandbox
    note bottom-left, "no real money moves" bottom-right (collapses to a top
    bar on phones).
  - Hero (poster): one statement across the grid, "Invoices that chase
    themselves." plus one meta line. No image.
  - Ledger (index list): live rows for invoices created in this session
    (localStorage), plus any invoice the visitor looks up. Each row: ID in
    mono, description, amount in tabular mono, due date, status pill. The
    overdue row carries the stamp.
  - Workbench (asymmetric pair): the four steps as ruled ledger entries on
    the left (7 cols), the running invoice in progress on the right (4 cols,
    offset). The forms live here.
  - Footer (statement): one large line, "Nothing sends without your say-so.",
    then real links (repo, PayPal sandbox) and small print.
- Genericness test: would a generic model land here? The previous version
  (centred 560px column, teal accent, four equal step cards, tracked
  uppercase eyebrow) — yes, that is the SaaS card kit, tell #4, and the
  eyebrow is template chrome, tell #5. Changed: the ledger system, the
  stamp, mono figures, one red reserved for overdue, no eyebrow labels, no
  equal cards, no teal accent.

## Build notes

- Same API calls, same element IDs as the current page. The ledger is
  session-only (localStorage): invoices created in this browser session,
  plus looked-up ones. Never fake an invoice, never invent a number.
- The stamp renders only for a genuinely overdue invoice (server says so).
- No em dashes or en dashes in visible text. Sentence case. Specific nouns.
- Accessibility: one h1, landmarks, skip link, visible focus in accent red,
  AA contrast, reduced-motion path with everything visible.
