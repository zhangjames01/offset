# Offset demo script (A7)

Click-by-click script for the live demo and the Devpost video. It runs in about **2:30**, and the video limit is 3:00. The flow is the same as the A6 Playwright test (`tests/e2e/demo-flow.spec.ts`). If a label here stops matching the app, the E2E test breaks too.

- **App:** https://offset-udcc.onrender.com (PayPal sandbox; no real money moves)
- **Demo user:** `demo-user`, seeded from `mocks/preferences.json` on every deploy. It has $100/month, $5/order, climate + fast fashion causes, and skips packaging.
- **Causes:** all five are placeholder partners. Each one shows "PLACEHOLDER — no impact figure until sourced". Don't claim any real-world impact in the narration.

## Before you record (T–10 min)

1. **Reset the demo user.** From the repo, with the Render `DATABASE_URL` in `.env.local`:
   - Run `npm run demo:reset` first. It's a dry run that lists what it would delete.
   - Then run `npm run demo:reset -- --yes`.

   This clears demo-user's orders, ledger entries, payout batches and classifications, then re-applies the demo preferences, so this month's giving starts at $0. If you skip it, the cap can turn every card into $0.00. The dry run lists orders by status. `--yes` refuses while an order is CAPTURING (a checkout in progress). Unpaid orders from closed PayPal pop-ups are deleted safely: a later capture of one gets 404 and charges nothing.
2. **Wake Render.** Open the app and wait for the store to load. A free instance takes about a minute after 15 idle minutes.
3. **Check Render env:**
   - `LLM_MODE=live`
   - `PAYPAL_MODE=sandbox`
   - `PAYOUT_MODE=sandbox` (or `simulated`, which shows a SIMULATED badge)
   - `PAYOUT_THRESHOLD_CENTS=100`. The tee's $1.00 only pays out at a $1 threshold or lower.
4. **Have these ready** (not on screen):
   - the sandbox **buyer** (personal) email and password. The merchant account gets "associated with the merchant".
   - the admin token. The field is masked.
5. **Browser:** a fresh profile or a private window, 1280×800, zoom 100%, pop-ups allowed for the app. Close other tabs and turn off notifications.
6. **Optional dry run:** `npm run test:e2e` (see `tests/e2e/README.md`) runs this exact flow in about 70 s. Afterwards, run the reset again.

## The run

| # | Time | Click / type | Say | On screen | If it goes wrong |
|---|------|--------------|-----|-----------|------------------|
| 1 | 0:00 | Store page (`/`) | "Offset turns every purchase into a small, matched donation. You pay with PayPal, and AI picks the cause that fits what you bought." | 6 products, empty cart | Blank or slow page → Render is waking; wait, or cut and retake |
| 2 | 0:12 | **Preferences** (nav) → clear **In your own words** → type: `I care about climate and fast fashion. Up to $100 a month, $5 per order. Skip packaging.` | "I set my preferences in plain English." | Text box filled | — |
| 3 | 0:25 | **Update from text** | "Claude reads it into settings I can check and edit. The model only extracts; our code sets the dollar limits." | "Review the choices below"; chips **Carbon removal** + **Textile recycling** on, **Single-use packaging** under "Don't suggest donations for"; **Monthly cap** 100, **Max per order** 5 | Wrong chip → click it to fix it on camera ("and I can correct it") |
| 4 | 0:38 | **Save preferences** | — | "✓ Saved" | — |
| 5 | 0:42 | **Store** → **JFK → LAX economy** → **Add to cart** → **Checkout** (in the cart) | "Now I book a $249 flight." | Checkout page; the **Suggested donation** card loads in about 1–2 s | Card shows "rule-based fallback" → keep going: "if the AI is unavailable, a rules engine takes over" |
| 6 | 0:50 | Point at the card | "Claude classified this as air travel and matched it to carbon removal. The rate is 3% of the fare, $7.47, and my $5 per-order limit caps it at $5.00." | **Air travel** · Carbon removal (placeholder partner) · a short reason · **$5.00** · "Rate: 3% of fare" · "Capped at your per-order max (suggested $7.47)." · **✓ Included** | **$0.00** / "Reduced to fit your monthly cap" → the reset wasn't run; stop, reset, retake |
| 7 | 1:00 | PayPal button → sandbox pop-up: email → **Next** → password → **Log In** → pay | "The donation is a separate line item in the same PayPal order: one payment." | Pop-up closes → **Payment complete**, "$254.00 charged", "**$5.00** is going to **Carbon removal (placeholder partner)**. Thank you!" | Pop-up blocked → allow pop-ups and click again. Slow sandbox → trim the wait in the edit |
| 8 | 1:18 | **Store** → **Graphic tee 3-pack** → **Add to cart** → **Checkout** | "Next, a fast-fashion tee pack." | Card: **Fast fashion** · Textile recycling (placeholder partner) · **$0.50** · "Rate: 2% of item price" | — |
| 9 | 1:25 | **Edit** → Amount `1.00` → **Save** | "I'm always in control. I can raise it, lower it, or remove it." | **$1.00** · "You changed this from $0.50." | The field won't accept a value → the most allowed is the $5 per-order max |
| 10 | 1:35 | PayPal button → pay (the login is usually remembered) | — | **Payment complete**, "$25.99 charged", "**$1.00** is going to **Textile recycling (placeholder partner)**. Thank you!" | Same as row 7 |
| 11 | 1:48 | **Impact** (nav). If you opened Impact earlier in this tab, press **F5** | "Every donation goes into a ledger. Causes here are placeholder partners; we show no impact numbers until they're sourced." | **$6.00** donated across 2 orders; Carbon removal $5.00 / $1.00 threshold, Textile recycling $1.00; each cause has the amber **PLACEHOLDER** line; the Donations table shows "Fast fashion · edited" | Old rows or a higher total → the reset wasn't run (fine for a live demo; retake for the video) |
| 12 | 2:00 | **Admin** (top right) → **Admin token** → **Apply token** | "Once a cause's balance reaches the threshold, we pay it out in a batch." | **Payouts** page (SIMULATED badge only in simulated mode); **Pending balances** with PLACEHOLDER lines, Carbon removal and Textile recycling "Ready for the next payout" | Token rejected → re-paste it; Jay may have rotated it |
| 13 | 2:08 | **Run payout** → **OK** in "Run payout now?" | "This is a real PayPal Payouts batch in sandbox, one item per cause." | **Payout batch** panel: Carbon removal $5.00 + Textile recycling $1.00, Total $6.00, status badge PENDING or SUCCESS | "No cause has reached the … threshold yet" → the threshold is above $1 or the reset wiped the orders; say "balances are below the threshold" and move on |
| 14 | 2:15 | **Refresh status** (repeat every ~5–10 s until the button disappears; it took 4 clicks and about 40 s on Nov 12) | "PayPal confirms the payout, and the ledger updates." | Batch SUCCESS; on **Impact**, both donations say **Paid out** (or **Paid out (simulated)**) | Still pending after about 60 s → end on the PENDING batch and say "settles in seconds"; cut in the edit |
| 15 | 2:25 | **Impact** (nav), then press **F5** | "Offset: shop as usual, offset as you go, all in one PayPal checkout." | Both new rows say **Paid out**; balances back to $0.00 | Still "Pending payout" → you skipped F5; the nav link can show the copy of the page from row 11 |

## Dry run, Nov 12 (Render, live AI, PayPal sandbox)

Rows 1–14 matched this script with the live parser and classifier. Paying took about 35 s for both orders, including the two PayPal pop-ups. The payout went from PENDING to paid out in about 40 s. Two findings are folded into the rows above:

- The order confirmation names the cause with "(placeholder partner)".
- After the payout, clicking **Impact** in the nav showed the version of the page from row 11, still "Pending payout", while `/api/ledger` already said paid out. A reload (F5) shows the right state. Fix for Hua (H7): have the Impact page reload its data when it's shown again.

Without a reset first, Impact showed $55.00 across 19 orders (older test runs). After `demo:reset -- --yes` it should show $6.00 across 2 orders.

## After the demo

- If judges will use the same account, run `npm run demo:reset -- --yes` again so they start at $0 with the demo preferences.
- Each run adds $6.00 to the demo user's month. Without a reset, ~16 runs reach the $100 cap.
- Sandbox only: the buyer, merchant and cause receivers are PayPal sandbox accounts. Payouts use no real money.
