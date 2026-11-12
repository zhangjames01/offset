/**
 * npm run classify:eval            real Claude calls over the 30 labeled carts (A5)
 * npm run classify:eval -- --rules keyword classifier only (no key, no network)
 *
 * Prints one line per cart, then accuracy (all / demo / coverage / edge / per label),
 * guardrail failures and latency. Exits 1 if demo accuracy < 90% or any hard guardrail fails
 * (soft ones, like the word "category" in a reason, print as warnings).
 * Live needs LLM_API_KEY in .env.local; 30 calls ≈ $0.003 on Haiku 5.5. No cache, so every
 * cart is a fresh call; LLM failures show up as "answered by the LLM" failures.
 */
import type { ClassifyRequest } from "@/contracts";
import { type ClassifyStore, classify, mockClassifyStore } from "@/lib/classifier";
import { type CartScore, type EvalMode, type LabeledCart, scoreCart, summarize } from "@/lib/classifier/eval";
import { DEFAULT_MODEL, TIMEOUT_MS, anthropicClassifier } from "@/lib/classifier/llm";
import { mockPreferences } from "@/lib/mocks";
import cartsJson from "@/tests/fixtures/carts.json";

const mode: EvalMode = process.argv.includes("--rules") ? "rules" : "live";

if (mode === "live") {
  let envFileFound = true;
  try {
    process.loadEnvFile(".env.local");
  } catch {
    envFileFound = false;
  }
  if (!process.env.LLM_API_KEY) {
    console.error(
      envFileFound
        ? "LLM_API_KEY is empty in .env.local. Put the full key on its own line: LLM_API_KEY=sk-ant-api03-…"
        : `No .env.local found in ${process.cwd()}. Run: Copy-Item .env.example .env.local, then set LLM_API_KEY.`,
    );
    console.error("Or run without a key: npm run classify:eval -- --rules");
    process.exit(1);
  }
}

// The demo user's preferences (opts out of packaging, $15/month, $5/order) with nothing
// given yet this month, so every cart exercises the opt-out and per-order rules.
const prefs = mockPreferences;
let seq = 0;
const evalStore: ClassifyStore = {
  getUnitPriceCents: mockClassifyStore.getUnitPriceCents,
  getPreferences: async () => prefs,
  getMonthToDateCents: async () => 0,
  newClassificationId: () => `cls_eval_${++seq}`,
  save: async () => {},
};

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "-");

async function main() {
  const carts = cartsJson.carts as unknown as (LabeledCart & { request: ClassifyRequest })[];
  const llm = mode === "live" ? anthropicClassifier() : undefined;
  console.log(`mode=${mode}${mode === "live" ? `  model=${process.env.LLM_MODEL || DEFAULT_MODEL}` : ""}  carts=${carts.length}\n`);

  const scores: CartScore[] = [];
  const latencies: number[] = [];
  for (const c of carts) {
    const started = Date.now();
    const r = await classify(c.request, { llm, store: evalStore });
    const ms = Date.now() - started;
    latencies.push(ms);
    const s = scoreCart(c, r, { mode, ms, timeoutMs: TIMEOUT_MS, prefs });
    scores.push(s);

    const want = `${c.expected.category}${c.expected.lowConfidence ? "(low)" : ""}`;
    const bad = s.checks.filter((x) => !x.ok);
    console.log(
      `${s.correct ? "PASS" : "FAIL"} ${c.id} [${c.tags.join(",")}] expected=${want} got=${s.got} ` +
        `conf=${r.confidence.toFixed(2)} donation=${r.donationCents}¢/${r.suggestedDonationCents}¢ adj=${r.adjustment ?? "-"} ` +
        `src=${r.source} ${ms}ms`,
    );
    console.log(`     reason: ${r.reason}`);
    for (const b of bad) console.log(`     ${b.soft ? "WARN" : "GUARDRAIL ✗"} ${b.name}${b.detail ? ` (${b.detail})` : ""}`);
  }

  const sum = summarize(carts, scores);
  console.log("\nAccuracy");
  for (const g of sum.groups) console.log(`  ${g.group.padEnd(22)} ${g.correct}/${g.total}  ${pct(g.correct, g.total)}`);
  console.log("By label");
  for (const g of sum.byCategory) console.log(`  ${g.group.padEnd(22)} ${g.correct}/${g.total}`);

  const hard = scores.flatMap((s) => s.checks.filter((c) => !c.soft));
  console.log(`Guardrails: ${hard.filter((c) => c.ok).length}/${hard.length} passed`);
  for (const f of sum.failedChecks) console.log(`  ✗ ${f.name}: ${f.ids.join(", ")}`);
  for (const w of sum.warnings) console.log(`  warning: ${w.name}: ${w.ids.join(", ")}`);

  const sorted = [...latencies].sort((a, b) => a - b);
  const avg = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
  console.log(`Latency: avg ${avg}ms, p50 ${sorted[Math.floor(sorted.length / 2)]}ms, max ${sorted.at(-1)}ms`);

  const demo = sum.groups[1];
  console.log(
    `\n${sum.passed ? "PASS" : "FAIL"}: demo ${demo.correct}/${demo.total} (${pct(demo.correct, demo.total)}, gate 90%), ` +
      `${sum.failedChecks.length ? `${sum.failedChecks.length} guardrail(s) failing` : "all guardrails pass"}`,
  );
  process.exitCode = sum.passed ? 0 : 1;
}

void main();
