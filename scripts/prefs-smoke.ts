/**
 * npm run prefs:smoke — real Claude calls over the labeled preference texts (A4 smoke test).
 * Needs LLM_API_KEY in .env.local. One call per text (fractions of a cent on Haiku 5.5).
 * Calls the LLM directly (no rules fallback), so a failure shows up as FAIL, not a quiet rules answer.
 */
import { DEFAULT_MODEL, LlmError } from "@/lib/classifier/llm";
import { toPreferences } from "@/lib/preferences-parser";
import { anthropicPreferencesExtractor } from "@/lib/preferences-parser/llm";
import fixtures from "@/tests/fixtures/preferences.json";

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

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

async function main() {
  const llm = anthropicPreferencesExtractor();
  const model = process.env.LLM_MODEL || DEFAULT_MODEL;
  console.log(`model=${model}  texts=${fixtures.cases.length}\n`);

  let passed = 0;
  const latencies: number[] = [];
  for (const c of fixtures.cases) {
    const started = Date.now();
    try {
      const p = toPreferences(c.rawText, await llm(c.rawText), "demo-user", new Date());
      latencies.push(Date.now() - started);
      const e = c.expected;
      const misses = [
        !sameSet(p.causes, e.causes) && `causes ${JSON.stringify(p.causes)} ≠ ${JSON.stringify(e.causes)}`,
        !sameSet(p.optOutCategories, e.optOutCategories) &&
          `optOuts ${JSON.stringify(p.optOutCategories)} ≠ ${JSON.stringify(e.optOutCategories)}`,
        p.monthlyCapCents !== e.monthlyCapCents && `monthly ${p.monthlyCapCents} ≠ ${e.monthlyCapCents}`,
        p.perOrderMaxCents !== e.perOrderMaxCents && `perOrder ${p.perOrderMaxCents} ≠ ${e.perOrderMaxCents}`,
      ].filter(Boolean);
      if (misses.length === 0) passed++;
      console.log(`${misses.length ? "MISS" : "ok  "}  ${c.id.padEnd(32)} ${Date.now() - started}ms  ${misses.join("; ")}`);
    } catch (err) {
      const why = err instanceof LlmError ? `${err.kind}: ${err.message}` : String(err);
      console.log(`FAIL  ${c.id.padEnd(32)} ${why}`);
    }
  }

  const avg = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
  console.log(`\n${passed}/${fixtures.cases.length} match  avg ${avg}ms  max ${Math.max(0, ...latencies)}ms`);
  process.exitCode = passed === fixtures.cases.length ? 0 : 1;
}

main();
