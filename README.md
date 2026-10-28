# Offset

**Purchase-linked giving at checkout.** Offset classifies what you're buying, suggests a small donation to a matching cause (a flight → carbon removal, food delivery → a food bank), and adds it as its own line item in the PayPal checkout. Built for the PayPal AI Hackathon 2026.

> Status: day-one scaffold. Every API route runs in **mock mode**, so the frontend can be built before PayPal and the LLM are wired up.

## Quick start

Requires **Node 22.12+** (`node -v`). Works on Windows, macOS, and Linux.

```bash
git clone https://github.com/zhangjames01/offset.git
cd offset
npm ci
cp .env.example .env.local      # Windows PowerShell: Copy-Item .env.example .env.local
npm run dev                     # http://localhost:3000
```

No secrets are needed in mock mode. Try <http://localhost:3000/api/catalog>.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm test` | Unit tests (Vitest): contracts, mocks, route handlers |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm run ci` | Everything CI runs: lint → typecheck → test → build |
| `npm run db:generate` / `npm run db:migrate` | Prisma (once the schema has models) |

## Modes

Set in `.env.local`. Defaults need no secrets.

| Variable | Values | Default |
| --- | --- | --- |
| `LLM_MODE` | `mock` (canned `mocks/classify/*.json`) · `live` · `rules` | `mock` |
| `PAYPAL_MODE` | `mock` (fake order IDs) · `sandbox` | `mock` |
| `PAYOUT_MODE` | `sandbox` · `simulated` (shown with a SIMULATED badge) | `simulated` |
| `PAYOUT_THRESHOLD_CENTS` | integer cents | `500` |

Real modes that aren't built yet return `501 NOT_IMPLEMENTED`.

## API

All request/response shapes are zod schemas in [`contracts/`](contracts/), the single source of truth. Money is always **integer cents**. Errors are `{"error": {"code", "message"}}` with a 4xx/5xx status.

| Method | Path | Owner | Purpose |
| --- | --- | --- | --- |
| GET | `/api/catalog` | Jay | Demo products |
| POST | `/api/preferences/parse` | James | Plain text → Preferences |
| GET / PUT | `/api/preferences` | Jay | Load / save the demo user's preferences |
| POST | `/api/classify` | James | Cart → ClassifyResponse |
| POST | `/api/checkout/create-order` | Jay | Builds the PayPal order (purchase + donation line items) |
| POST | `/api/checkout/capture` | Jay | Captures the order, writes the LedgerEntry (idempotent) |
| GET | `/api/ledger` | Jay | Entries + balance per cause |
| POST | `/api/payouts/run` | Jay | Threshold batching → PayoutBatch (`x-admin-token` header) |
| GET | `/api/payouts/:id` | Jay | Refresh batch status |

In mock mode the checkout → capture → ledger → payout flow is stateful in memory (resets on restart). Outside production, `x-admin-token: dev-admin` works when `ADMIN_TOKEN` is blank.

## Repo layout

```
app/            pages + api/ route handlers (one folder per endpoint)
components/     UI (Hua)
contracts/      zod schemas + TS types — 2 approvals to change
lib/            api helpers, mocks, paypal/ (Jay), classifier/ (James), ledger/
mocks/          catalog, causes, classify/*.json, paypal/*.json, ledger, preferences
prisma/         schema.prisma (Jay, J2)
tests/          unit/, e2e/, fixtures/carts.json
docs/           demo script
```

## Contributing

- `main` is protected and always deployable. Branch as `name/short-topic` (e.g. `jay/capture-ledger`).
- PRs need 1 approval + green CI, are squash-merged, and stay under ~300 changed lines.
- `contracts/` changes need 2 approvals and a heads-up in the group chat. Mocks are validated against contracts in CI, so they can't drift.
- Secrets go in `.env.local` only, shared privately — never in the repo.

## License

[MIT](LICENSE) © 2026 The Offset team
