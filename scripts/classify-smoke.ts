/**
 * npm run classify:smoke — real Claude calls over the labeled carts (A2 smoke test).
 * Needs LLM_API_KEY in .env.local. ~1 call per cart (fractions of a cent on Haiku 5.5).
 * A5 grows this into the full eval (accuracy + guardrail checks).
 */
import type { ClassifyRequest } from "@/contracts";
import { LlmError, classify, mockClassifyStore } from "@/lib/classifier";
import { DEFAULT_MODEL, anthropicClassifier } from "@/lib/classifier/llm";
import cartsJson from "@/tests/fixtures/carts.json";

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
  process.exit(1);
}

async function main() {
  const llm = anthropicClassifier();
  const model = process.env.LLM_MODEL || DEFAULT_MODEL;
  let correct = 0;
  const latencies: number[] = [];
  console.log(`model=${model}  carts=${cartsJson.carts.length}\n`);

  for (const c of cartsJson.carts) {
    const cart = c.request as ClassifyRequest;
    const started = Date.now();
    try {
      const r = await classify(cart, { llm, store: mockClassifyStore });
      const ms = Date.now() - started;
      latencies.push(ms);
      const lowConf = r.adjustment === "low_confidence";
      const ok = lowConf ? c.expected.lowConfidence : r.category === c.expected.category && !c.expected.lowConfidence;
      if (ok) correct++;
      console.log(
        `${ok ? "PASS" : "FAIL"} ${c.id} expected=${c.expected.category}${c.expected.lowConfidence ? "(low)" : ""} ` +
          `got=${r.category} conf=${r.confidence.toFixed(2)} donation=${r.donationCents}¢/${r.suggestedDonationCents}¢ ` +
          `adj=${r.adjustment ?? "-"} ${ms}ms\n     reason: ${r.reason}`,
      );
    } catch (err) {
      if (!(err instanceof LlmError)) throw err;
      console.log(`ERR  ${c.id} ${err.kind}: ${err.message}`);
    }
  }
  const avg = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
  console.log(`\n${correct}/${cartsJson.carts.length} correct, avg ${avg}ms, max ${Math.max(0, ...latencies)}ms`);
}

void main();
