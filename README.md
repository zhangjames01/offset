# Offset

**Purchase-linked giving at checkout.** Offset reads what's in your cart, suggests a small donation to a cause that matches it (a flight → carbon removal, a fast-fashion haul → textile recycling, food delivery → a food bank), and adds it as its own line item in the same PayPal checkout. Donations collect in a ledger and are paid out to each cause in batches with PayPal Payouts. Built for the [PayPal AI Hackathon 2026](https://paypalaihackathon.devpost.com/).

- **Live demo:** <https://offset-udcc.onrender.com> (PayPal **sandbox** — no real money moves)
- **Video:** _YouTube link — see the Devpost page_
- **License:** [MIT](LICENSE)

> All five causes are **placeholder partners**. The app shows "PLACEHOLDER — no impact figure until sourced" under each one and makes no real-world impact claims.

## For judges: try it in 3 minutes

The sandbox buyer login and the admin token are in the **Devpost testing instructions** (kept out of this public repo so nobody can lock the account).

1. Open <https://offset-udcc.onrender.com>. The free Render instance sleeps when idle, so the first load can take **about a minute**.
2. **Preferences** → type in your own words, e.g. `I care about climate and fast fashion. Up to $100 a month, $5 per order. Skip packaging.` → **Update from text**. Claude turns it into causes, opt-outs and limits you can check and edit → **Save preferences**.
3. **Store** → add **JFK → LAX economy** → **Checkout**. The **Suggested donation** card shows the category Claude picked, a one-line reason, the rate rule (3% of fare = $7.47) and the per-order cap ($5.00). You can **Edit** the amount or **Remove** it.
4. Pay with the PayPal button using the **sandbox buyer** from Devpost. The donation is a separate `Donation: … (via Offset)` line item in the same PayPal order.
5. Try another product (the tee pack, ramen delivery, the snack box) and edit or remove the donation.
6. **Impact** shows every donation (marked "edited" if you changed the amount) and each cause's balance against the payout threshold. The raw ledger at [`/api/ledger`](https://offset-udcc.onrender.com/api/ledger) also records how each one was classified (`llm`, `cache` or `rules`).
7. **Admin** (top right) → paste the admin token → **Apply token** → **Run payout**. This sends a real PayPal **Payouts** batch in sandbox, one item per cause at or above the threshold. Click **Refresh status** until it shows SUCCESS, then reload **Impact**: those donations now say **Paid out**.

Everyone shares one demo account (`demo-user`), so you may see other testers' orders. The $100 monthly cap counts the current calendar month (UTC).

## How it works

```
Cart ──► /api/classify ──► Claude Haiku 5.5: category + confidence + reason (JSON schema, zod-validated)
                           └─ on any error / timeout / rate limit ─► keyword rules classifier
         code (not the LLM) computes the amount: rate rule → opt-outs → low confidence → per-order + monthly caps
Donation card (accept / edit / remove) ──► /api/checkout/create-order ──► PayPal Orders v2 (items + donation line item)
PayPal buttons ──► /api/checkout/capture ──► PayPal capture ──► LedgerEntry (idempotent, one per PayPal order)
Admin ──► /api/payouts/run ──► per-cause balances ≥ threshold ──► PayPal Payouts batch ──► /api/payouts/:id refresh ──► paid_out
```

**AI (Claude, Anthropic API).** Two calls, both on `claude-haiku-5-5` with structured JSON output:

- **Classifier** ([`lib/classifier/`](lib/classifier/)): cart → one of five categories, a confidence and a short shopper-facing reason. Results are cached (LRU, 24 h), rate-limited (20 calls/IP/min, 1,000/day), and fall back to a rules classifier on any failure, so checkout never breaks. The card says "rule-based fallback" when that happens.
- **Preferences parser** ([`lib/preferences-parser/`](lib/preferences-parser/)): plain English → causes, opt-outs and limits as written. Code converts them to cents and clamps them ($100/month and $25/order ceilings).

The model only classifies and extracts. **Every dollar amount is computed in code** ([`lib/classifier/rates.ts`](lib/classifier/rates.ts), [`pricing.ts`](lib/classifier/pricing.ts)), so a prompt injection in a product name can't change what you're charged.

| Category | Rate | Cause |
| --- | --- | --- |
| Air travel | 3% of fare | Carbon removal |
| Fast fashion | 2% of item price | Textile recycling |
| Food delivery | flat $1.00 | Food bank |
| Single-use packaging | 1% of item price | Ocean plastic cleanup |
| General / low confidence | round up to the next dollar (low confidence: flat $1.00) | General giving fund |

**PayPal.** Orders v2 (create + capture, with `PayPal-Request-Id` idempotency keys), the JS SDK buttons (`@paypal/react-paypal-js`), and Payouts v1 for batched disbursements to each cause's sandbox receiver, with status reconciliation back into the ledger.

**Stack.** Next.js 16 (App Router) + React 19 + TypeScript + Tailwind 4, zod contracts in [`contracts/`](contracts/), Prisma 7 + Postgres (Neon), deployed on Render.

## Run it locally

Requires **Node 22.12+** (`node -v`). Works on Windows, macOS and Linux.

```bash
git clone https://github.com/zhangjames01/offset.git
cd offset
npm ci
cp .env.example .env.local      # Windows PowerShell: Copy-Item .env.example .env.local
npm run dev                     # http://localhost:3000
```

**Mock mode (no accounts needed).** The defaults in `.env.example` run the whole flow with canned classifications, fake PayPal order IDs and simulated payouts, all in memory (resets on restart). `LLM_MODE=rules` swaps in the keyword classifier and parser, still with no network.

**Full mode (Claude + PayPal sandbox + Postgres).** Fill in `.env.local`:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Any Postgres (Neon, Docker, local) |
| `LLM_MODE` / `LLM_API_KEY` | `live` + an [Anthropic API key](https://console.anthropic.com/) |
| `PAYPAL_MODE` / `PAYPAL_ENV` | `sandbox` / `sandbox` |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | A sandbox REST app from [developer.paypal.com](https://developer.paypal.com/) |
| `PAYOUT_MODE` | `sandbox` (real sandbox Payouts) or `simulated` (labeled SIMULATED) |
| `CAUSE_RECEIVER_*` | One sandbox **personal** account email per cause |
| `PAYOUT_THRESHOLD_CENTS` | e.g. `100` so a $1 balance pays out |
| `ADMIN_TOKEN` | Any secret; the Admin page asks for it |

Then create the tables and the demo user:

```bash
npx prisma migrate deploy
npm run db:seed
npm run dev
```

To pay, log in to the PayPal pop-up with a sandbox **personal** account (not the merchant's business account).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm test` | Unit tests (Vitest): contracts, mocks, pricing, classifier, parser, routes |
| `npm run ci` | Everything CI runs: lint → typecheck → test → build |
| `npm run classify:eval` | Classifier eval on 30 labeled carts with guardrail checks (`-- --rules` runs without an API key) |
| `npm run classify:smoke` / `npm run prefs:smoke` | Live smoke tests of the two Claude calls |
| `npm run test:e2e` | Playwright run of the full demo against the deployed app in sandbox ([`tests/e2e/README.md`](tests/e2e/README.md)) |
| `npm run demo:reset` | Dry run of a demo-user reset; `-- --yes` clears its orders, ledger and payouts ([`docs/demo-script.md`](docs/demo-script.md)) |

## API

All request and response shapes are zod schemas in [`contracts/`](contracts/). Money is always **integer cents**. Errors are `{"error": {"code", "message"}}` with a 4xx/5xx status.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/catalog` | Demo products |
| POST | `/api/preferences/parse` | Plain text → Preferences (Claude, rules fallback) |
| GET / PUT | `/api/preferences` | Load / save the demo user's preferences |
| POST | `/api/classify` | Cart → category, reason, suggested donation |
| POST | `/api/checkout/create-order` | PayPal order with purchase + donation line items |
| POST | `/api/checkout/capture` | Captures the order and writes the ledger entry (idempotent) |
| GET | `/api/ledger` | Ledger entries + balance per cause |
| POST | `/api/payouts/run` | Threshold batching → PayPal Payouts batch (`x-admin-token` header) |
| GET | `/api/payouts/:id` | Refresh a batch's status from PayPal |

## Repo layout

```
app/            pages + api/ route handlers
components/     UI
contracts/      zod schemas + TS types (the API contract)
lib/            classifier/, preferences-parser/, paypal/, payouts/, ledger/
mocks/          catalog, causes, canned responses for mock mode
prisma/         schema, migrations, seed, demo-user reset
scripts/        evals, smoke tests, demo reset
tests/          unit/, e2e/, fixtures/
docs/           demo script, Devpost text
```

## Team

Built by The Offset team: Jay (backend, PayPal, ledger), Hua (frontend, demo), James (AI classifier and parser, tests, submission).

## License

[MIT](LICENSE) © 2026 The Offset team
