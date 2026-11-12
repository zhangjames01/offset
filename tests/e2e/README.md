# E2E demo test (A6)

`demo-flow.spec.ts` runs the full demo against a **deployed** app in PayPal sandbox:
preferences → flight (donation capped at $5) → tee with the donation edited to $1.00 → impact page → admin payout.

It is not part of CI (it needs sandbox credentials and writes real rows to the deployed database).

## Run it

```bash
npx playwright install chromium   # once per machine
npm run test:e2e
npx playwright show-report        # trace, video and screenshots of the last run
```

Settings come from the environment or a `.env.e2e` file in the repo root (gitignored, like every `.env*` file):

| Var | Required | Notes |
|---|---|---|
| `PAYPAL_SANDBOX_BUYER_EMAIL` / `PAYPAL_SANDBOX_BUYER_PASSWORD` | yes | Sandbox **personal** account that approves the orders |
| `E2E_ADMIN_TOKEN` | yes | Must match `ADMIN_TOKEN` on the server |
| `E2E_BASE_URL` | no | Defaults to `https://offset-udcc.onrender.com` |
| `E2E_EXPECT_LLM` | no | `1` asserts the donation cards and preferences came from the model (`LLM_MODE=live`), not rules |

Without the required vars the test is skipped.

## What it changes on the server

Each run saves the demo user's preferences ($100/month, $5/order), creates two sandbox orders ($5.00 + $1.00 in donations)
and runs a payout, which also pays out any other pending balances at or above the threshold.
