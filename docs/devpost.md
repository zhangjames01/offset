# Devpost submission (A8)

Everything that goes into the Devpost form, ready to paste. Devpost closes **Thu Nov 12, 2026, 12:00 pm PT**. Judging runs Dec 1–15, and the app must stay up and free to test until then.

## Before you submit

| # | Who | Step | Done when |
|---|-----|------|-----------|
| 1 | Jay | Rotate `ADMIN_TOKEN` on Render to a new judge-only value (the old one was pasted in chat) | Old token rejected on /admin, new one works |
| 2 | James | Create a judge-only sandbox buyer: developer.paypal.com → Testing Tools → Sandbox Accounts → **Create account** → Personal, US, PayPal balance $5,000 | It can pay one order on the live app |
| 3 | Jay | Confirm Render env: `LLM_MODE=live`, `PAYPAL_MODE=sandbox`, `PAYOUT_MODE=sandbox`, `PAYOUT_THRESHOLD_CENTS=100`, prod `LLM_API_KEY` valid past Dec 15 | Donation card has no "rule-based fallback" label |
| 4 | James | `npm run demo:reset` (dry run, check the DB host) → `npm run demo:reset -- --yes` | Impact shows no donations |
| 5 | James | Record the video (script below), Hua edits (H8), upload to YouTube as **Public** | Link plays in a private window, length < 3:00 |
| 6 | James | Repo About: description (fix "PayPal A Hackathon"), website = the Render URL, MIT license shows | Visible on github.com/zhangjames01/offset |
| 7 | James | Add Jay and Hua as Devpost teammates | All three on the project page |
| 8 | James | Fill the form below, paste the video link, **Submit** before 12:00 pm PT | Devpost shows "Submitted" |
| 9 | James | After the video is final: `npm run demo:reset -- --yes` again so judges start clean | Impact shows no donations |

The month-to-date cap resets on Dec 1 (UTC calendar month), so judges start under the $100 cap even if we test more in November.

## Form fields

**Project name:** Offset

**Elevator pitch:** Shop as usual, offset as you go. AI matches each purchase to a cause and adds a capped donation to the same PayPal checkout.

**Try it out:**

- https://offset-udcc.onrender.com
- https://github.com/zhangjames01/offset

**Built with:** typescript, next.js, react, tailwindcss, paypal, paypal-orders-api, paypal-payouts, claude, anthropic, prisma, postgresql, neon, render, zod, vitest, playwright

**Video:** _YouTube link_

## About the project (paste into the story field)

```markdown
## Inspiration
Most of us would give a little to offset what we buy: a flight, a fast-fashion haul, another delivery order. But "offsetting" usually means a separate site, a separate payment, and guessing which cause fits. We wanted it to happen at checkout, in the payment people already use, with the user in control of every cent.

## What it does
Offset is a checkout add-on for online stores that pay with PayPal.

1. **Set preferences in plain English.** "I care about climate and fast fashion. Up to $100 a month, $5 per order. Skip packaging." Claude turns that into causes, opt-outs and limits you can review and edit.
2. **Get a matched suggestion at checkout.** Claude reads the cart and picks a category (air travel, fast fashion, food delivery, single-use packaging, or general) with a one-line reason. Our code turns that into an amount: 3% of a fare, 2% of a clothing order, a flat $1 for food delivery, then applies your per-order and monthly caps. A $249 flight suggests $7.47, capped to your $5.
3. **Stay in control.** Accept, edit (bounded by your limits) or remove the donation before paying.
4. **Pay once.** The donation is its own line item in the same PayPal order. One approval, one payment.
5. **See where it goes.** Every donation lands in a ledger. When a cause's balance crosses the threshold, an admin runs a PayPal Payouts batch, and the ledger marks those donations paid out.

The five causes are **placeholder partners** for the demo. The app labels them that way and shows no impact numbers until real partners are sourced.

## How we built it
- **Next.js 16 + React 19 + TypeScript** for the store, checkout, preferences, impact and admin pages and every API route, with **zod** contracts shared by frontend and backend. Money is always integer cents.
- **PayPal Orders v2** creates the order with the products plus a `Donation: <cause> (via Offset)` line item and captures it with idempotency keys, so a retry can't double-charge or double-count. The **PayPal JS SDK** buttons drive approval.
- **PayPal Payouts** batches pending donations per cause once they pass a threshold, then reconciles the batch status back into the ledger.
- **Prisma + Postgres (Neon)** store preferences, orders, classifications, the ledger and payout batches. The app runs on **Render** and deploys from `main`.
- Every route has a mock mode, so frontend, backend and AI work could proceed in parallel from day one.

## How we use AI
We use **Claude Haiku 5.5** through the Anthropic API for two jobs, both with structured JSON output validated by zod:
- **Cart classifier:** cart → category, confidence and a short, shopper-facing reason.
- **Preferences parser:** free text → causes, opt-outs and limits exactly as written.

The model **never decides money**. It classifies and extracts; deterministic code computes every amount and enforces the caps, so a prompt injection in a product name can't raise a charge. If Claude errors, times out or hits our rate limit, a keyword rules engine takes over and the card says "rule-based fallback", so checkout never breaks. Results are cached, so a repeated cart costs nothing. We measured it with a 30-cart labeled eval (demo carts, coverage carts and edge cases like injections, mystery boxes and non-English text): 30/30 correct, 0 guardrail failures, about 1.1 s average latency and roughly $0.0001 per classification.

We also used Claude as a coding assistant while building.

## Challenges we ran into
- **Keeping the AI out of the money path** while still letting it explain itself. The answer was a strict split: the model returns a category and reason; a rate table and cap logic in code produce cents.
- **Exactly-once payments.** Pop-ups get closed, captures retried and pages reloaded. Idempotency keys, one ledger row per PayPal order, and checks on cart changes keep the ledger honest.
- **Testing real PayPal flows.** We wrote a Playwright test that logs into the sandbox pop-up, pays two orders, runs a payout and waits for it to settle, against the deployed app.

## Accomplishments that we're proud of
- One PayPal checkout carries both the purchase and the donation, end to end, in sandbox: create, capture, ledger, payout, reconciliation.
- The AI is useful and boring in the right ways: fast, cheap, explainable, with a fallback that keeps the store working.
- An honest product: placeholder causes are labeled as placeholders, and the user can always change or remove the donation.

## What we learned
- Structured outputs plus code-side validation make an LLM safe to put in a checkout.
- Agreeing on API contracts and mock modes first let a three-person team build in parallel without blocking each other.

## What's next for Offset
- Real nonprofit partners (for example through PayPal's giving programs) with sourced impact figures.
- A merchant drop-in: one script tag or SDK option that adds the donation card to any PayPal checkout.
- Real user accounts, monthly impact summaries, and receipts for tax purposes.
```

## Testing instructions (judge access)

Paste into the field for judges' testing instructions or additional info. Fill in the two values; never commit them.

```text
Live app: https://offset-udcc.onrender.com (PayPal sandbox only; no real money moves)
The free Render instance sleeps when idle; the first load can take about a minute.

PayPal sandbox buyer (use this in the PayPal pop-up):
  Email:    <JUDGE SANDBOX BUYER EMAIL>
  Password: <JUDGE SANDBOX BUYER PASSWORD>

Admin token (Admin page, top right, to run payouts):
  <JUDGE ADMIN TOKEN>

Walkthrough (about 3 minutes):
1. Preferences: type "I care about climate and fast fashion. Up to $100 a month, $5 per order. Skip packaging." -> Update from text -> review the chips -> Save preferences.
2. Store: add "JFK -> LAX economy" -> Checkout. The Suggested donation card shows Claude's category and reason, the rate (3% of fare = $7.47) and your $5 per-order cap.
3. Pay with the PayPal button and the sandbox buyer above. The donation is its own line item in the same order.
4. Try the tee pack: Edit the donation to $1.00, then pay.
5. Impact: see both donations and each cause's balance.
6. Admin: paste the token -> Apply token -> Run payout -> OK. Click Refresh status until SUCCESS, then reload Impact: the donations say Paid out.

All judges share one demo account, so you may see other testers' orders. Causes are placeholder partners.
Run it locally instead: see the README (mock mode needs no accounts).
```

## Video (under 3:00)

The click path is [`demo-script.md`](demo-script.md) (rows 1–15, about 2:30). Do its "Before you record" steps first. This adds the opening and closing the judges score under Presentation (problem, audience, why it matters) and trims the middle to fit.

**Recording:** OBS or Xbox Game Bar (Win+Alt+R), 1280×800 browser window, 100% zoom, a fresh browser profile, notifications off. Record the screen and voiceover separately if that's easier. Hua edits (H8): cut PayPal and Render waits, no copyrighted music, no third-party logos beyond the PayPal UI itself.

| Time | Screen | Voiceover |
|------|--------|-----------|
| 0:00–0:15 | Store page | "Most people would happily offset what they buy: a flight, a fast-fashion order, another delivery. But it means a separate site, a separate payment, and guessing which cause fits. Offset does it inside the PayPal checkout you already use." |
| 0:15–0:40 | Preferences: type the demo text → Update from text → chips → Save (rows 2–4) | "I set my preferences in plain English. Claude turns them into settings I can check and edit: climate and fast fashion, skip packaging, up to $100 a month and $5 an order. The model only extracts; our code sets the dollar limits." |
| 0:40–1:05 | Flight → Checkout → donation card (rows 5–6) | "Now I book a $249 flight. Claude classifies the cart as air travel and explains why. Our rate table says 3% of the fare, $7.47, and my $5 per-order limit caps it. The AI never sets the amount." |
| 1:05–1:25 | PayPal pop-up → Payment complete (row 7; cut the login wait) | "The donation is a separate line item in the same PayPal order. One approval, one payment." |
| 1:25–1:50 | Tee pack → Edit to $1.00 → pay (rows 8–10) | "A fast-fashion tee pack suggests 50 cents for textile recycling. I'm always in control, so I raise it to a dollar. I could lower it or remove it too." |
| 1:50–2:05 | Impact (row 11) | "Every donation goes into a ledger, with a balance per cause. These causes are placeholder partners, so we show no impact numbers until they're sourced." |
| 2:05–2:30 | Admin → Run payout → Refresh status → Impact + F5 (rows 12–15; cut the waits) | "When a cause crosses its threshold, we pay it out with a real PayPal Payouts batch in sandbox, one item per cause. PayPal confirms it, and the ledger marks the donations paid out." |
| 2:30–2:50 | Slide or the README "How it works" diagram | "Under the hood: Claude Haiku classifies and extracts with validated JSON, a rules engine takes over if it fails, and code handles every cent. PayPal Orders, the JS SDK and Payouts cover the money. Offset: shop as usual, offset as you go." |

Upload as **Public** (not Unlisted) with the title "Offset — PayPal AI Hackathon 2026" and the repo and app links in the description.
