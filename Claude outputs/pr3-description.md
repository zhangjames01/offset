## What

A2 ★: `classify()` goes live. With `LLM_MODE=live`, `/api/classify` calls Claude Haiku 5.5 (`claude-haiku-5-5`) using JSON-schema output. The model returns only `{category, confidence, reason}`, which is validated by `LlmClassification` (zod). Every cent comes from code. `lib/classifier/rates.ts` holds the rate table, and `pricing.ts` applies the guardrails in this order: opted_out → low_confidence → per_order_max / monthly_cap. The cap that binds first sets the `adjustment` label. Matches the classify contract; `contracts/` is unchanged.

- **`lib/classifier/`**
  - `rates.ts`: rate table, in basis points and integer cents.
  - `pricing.ts`: `price()`.
  - `prompt.ts`: system prompt, JSON schema and cart text. The model never sees prefs, `productId` or `expectedCategory`.
  - `llm.ts`: Anthropic call with `max_tokens: 300`, a 4 s timeout, no retries and no `temperature`. Failures raise a typed `LlmError` (`invalid_output` / `timeout` / `rate_limited` / `api_error` / `not_configured`).
  - `index.ts`: `classify()`, plus a `ClassifyStore` interface for prefs and month-to-date giving.
- **`app/api/classify/route.ts`**: `live` calls `classify()`. An `LlmError` returns `CLASSIFY_FAILED` (503 when no key is set, otherwise 502) until A3 adds the rules fallback and cache. `rules` still returns 501. Mock mode is unchanged.
- **`scripts/classify-smoke.ts`** (`npm run classify:smoke`): runs the labeled carts against the real API.
- **`.env.example`**: documents `LLM_API_KEY` and adds an optional `LLM_MODEL`.
- **`.gitignore`**: adds `.idea/` and `.vscode/`.

## Testing

- `npm run ci` passes locally: lint, typecheck, 71 tests (was 30), and build. The PR merge commit (`refs/pull/3/merge`) also passes on a clean `npm ci`.
- New unit tests:
  - `pricing.test.ts`: `price()` reproduces all 6 `mocks/classify/*.json` exactly, plus edge cases for both caps, low confidence, and opt-out precedence.
  - `prompt.test.ts`: the JSON schema stays in sync with the zod contract.
  - `llm.test.ts`: request shape, zod rejection cases and SDK error mapping, all against a fake client.
  - `classify.test.ts`: `classify()` and the live route against a fake LLM.
- Live smoke test (`npm run classify:smoke`, Haiku 5.5): **6/6 correct**. Average latency 1.3 s, max 2.0 s (the first, cold call). About 950 input and 60 output tokens per call, roughly $0.0001 each. The gift card comes back at confidence 0.30, so it gets `low_confidence` with 100¢.

## Notes

- **Over the ~300-line guideline:** +1,297 total. About 410 lines are source and the smoke script, about 300 are tests, and the rest is the lockfile (`@anthropic-ai/sdk` and `tsx`). I kept it as one PR because it's a single critical-path unit.
- **Conflicts with #1 in `package.json` and `package-lock.json`:** both PRs add `tsx@^4.23.15`. Whichever merges second should merge `main`, keep both sides of `package.json`, and run `npm install` to rebuild the lockfile.
- **Jay, after J2:** `ClassifyStore` reads the in-memory mock store for now. Swap in a Prisma version of `getPreferences`, `getMonthToDateCents` and `save`. Month-to-date is the sum of the user's `LedgerEntry.amountCents` for the current UTC month.
- **Not in this PR:** the rules fallback, cache and rate limit (A3), and the preferences parser (A4). `Preferences.causes` isn't used for routing yet; the cause is always `DEFAULT_CAUSE[category]`.
- **New pricing rule:** "round up to next dollar" on an exact-dollar subtotal gives 100¢, not 0. I'll add this to the plan doc's contract notes.

## Checklist

- [x] CI is green (lint, typecheck, test, build)
- [ ] Under ~300 changed lines (see Notes)
- [x] Touches `contracts/`? No
- [x] Touches `mocks/`? No (mocks still validate, and `price()` reproduces them)
- [x] No secrets, keys, or `.env.local` in the diff
