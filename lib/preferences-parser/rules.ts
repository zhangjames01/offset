/**
 * Rules preferences parser (A4): keywords + regex, no network. Returns the same
 * Extracted shape as the LLM, so caps.ts applies identical conservative rules to both.
 * Used when LLM_MODE=rules, when the LLM fails (any LlmError), and when the LLM budget is spent.
 * Never throws.
 *
 * How it reads the text:
 *   1. Split into clauses on sentence punctuation, commas, "but"/"however", and an "and"
 *      followed by a negation ("climate and no flights" → "climate" | "no flights").
 *   2. A clause with a negation ("skip", "no", "don't", "except"…) turns its topics into
 *      opt-out categories; any other clause turns them into causes.
 *   3. Dollar amounts ("$15", "15 bucks", "50 cents", "$10–20") are tagged per-order or
 *      per-period from the words right after them (then before them). Untagged = monthly.
 *      A bare number counts only between a limit word and a unit ("max 15 a month",
 *      "limit 3 per order"), so "3 flights a month" stays a count, not money.
 *      Several amounts of the same kind → the lowest wins.
 */
import type { Category, CauseId } from "@/contracts";
import { type Extracted, type Period, type StatedLimit, toMonthlyCents, unique } from "./caps";

type Topic = { re: RegExp; cause?: CauseId; category?: Category };

/** Order matters only for the order causes are listed in. */
const TOPICS: Topic[] = [
  { re: /\b(flights?|flying|fly|air ?travel|air ?fares?|planes?|airlines?)\b/, cause: "carbon_removal", category: "air_travel" },
  { re: /\b(climate|carbon|emissions?|co2|global warming|environment)\b/, cause: "carbon_removal" },
  { re: /\b(fast[- ]fashion|fashion|cloth(es|ing)|apparel|textiles?)\b/, cause: "textile_recycling", category: "fast_fashion" },
  { re: /\b(food deliver(y|ies)|deliver(y|ies)|takeout|take-out|doordash|uber ?eats|grubhub)\b/, cause: "food_bank", category: "food_delivery" },
  { re: /\b(hunger|hungry|food banks?|food insecurity|feeding)\b/, cause: "food_bank" },
  { re: /\bfood\b/, cause: "food_bank", category: "food_delivery" },
  { re: /\b(packaging|single[- ]use|plastics?|disposables?)\b/, cause: "ocean_plastic", category: "single_use_packaging" },
  { re: /\b(oceans?|seas?|marine|litter|waste)\b/, cause: "ocean_plastic" },
  { re: /\b(general fund|any cause|wherever (it'?s |it is )?(most )?needed)\b/, cause: "general_fund" },
];

const NEGATION =
  /\b(skip|skipping|no|not|don'?t|do not|never|exclude|excluding|except|without|avoid|opt(ing)? out|leave out|ignore|nothing (for|on))\b/;

/** "no more than $15" is a limit, not an opt-out: rewrite these before looking for negations. */
const LIMIT_PHRASES: [RegExp, string][] = [
  [/\b(no|not|never) (more|higher|over|above)( than)?\b/g, "max"],
  [/\bnot (to )?exceed\b/g, "max"],
  [/\b(don'?t|do not|never) (spend|give|donate|go) (more|over|above)( than)?\b/g, "max"],
];

const PER_ORDER = /\b(per|each|every|a|an)\s+(orders?|purchases?|transactions?|checkouts?|items?|buys?|flights?|trips?|tickets?)\b|\bper[- ]order\b|\/\s*order\b/;
const PERIODS: [Period, RegExp][] = [
  ["month", /\bmonth(ly|s)?\b|\/\s*mo\b/],
  ["week", /\bweek(ly|s)?\b|\/\s*wk\b/],
  ["day", /\b(day|daily|days)\b/],
  ["year", /\b(year|yearly|years|annual|annually|yr)\b/],
];

const NUM = String.raw`(\d+(?:\.\d{1,2})?)`;
/** The unit must come right after a bare number: "15 a month", "3 per order", "100 yearly". */
const BARE_UNIT = String.raw`\s*(?:(?:a|an|per|each|every|\/)\s*(?:months?|mo|weeks?|wk|days?|years?|yr|orders?|purchases?|transactions?|checkouts?|items?)\b|(?:monthly|weekly|daily|yearly|annually)\b)`;
const MONEY_PATTERNS: { re: RegExp; read: (m: RegExpExecArray) => StatedLimit }[] = [
  // Ranges: "$10-20", "$10 to $20", "between $10 and $20", "10-20 dollars"
  {
    re: new RegExp(String.raw`\$\s*${NUM}\s*(?:-|–|—|to|and)\s*\$?\s*${NUM}`, "g"),
    read: (m) => ({ lowDollars: Number(m[1]), highDollars: Number(m[2]) }),
  },
  {
    re: new RegExp(String.raw`\b${NUM}\s*(?:-|–|—|to)\s*${NUM}\s*(?:dollars|bucks|usd)\b`, "g"),
    read: (m) => ({ lowDollars: Number(m[1]), highDollars: Number(m[2]) }),
  },
  // Singles: "$15", "15 dollars", "15 bucks", "50 cents"
  { re: new RegExp(String.raw`\$\s*${NUM}`, "g"), read: (m) => one(Number(m[1])) },
  { re: new RegExp(String.raw`\b${NUM}\s*(?:dollars|bucks|usd)\b`, "g"), read: (m) => one(Number(m[1])) },
  { re: new RegExp(String.raw`\b${NUM}\s*(?:cents|¢)`, "g"), read: (m) => one(Number(m[1]) / 100) },
  // Bare numbers: only "max 15 a month", "cap of 20 per month", "limit 3 per order", "budget 100 yearly".
  {
    re: new RegExp(String.raw`\b(?:max|maximum|cap|limit|up to|at most|budget)(?:\s+(?:of|is|at|to))?\s+${NUM}(?=${BARE_UNIT})`, "g"),
    read: (m) => one(Number(m[1])),
  },
];

const one = (d: number): StatedLimit => ({ lowDollars: d, highDollars: d });

type Amount = StatedLimit & { start: number; end: number };

function findAmounts(clause: string): Amount[] {
  const found: Amount[] = [];
  const taken = (s: number, e: number) => found.some((a) => s < a.end && e > a.start);
  for (const { re, read } of MONEY_PATTERNS) {
    re.lastIndex = 0;
    for (let m = re.exec(clause); m; m = re.exec(clause)) {
      const start = m.index;
      const end = start + m[0].length;
      if (!taken(start, end)) found.push({ ...read(m), start, end });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

type Kind = { kind: "perOrder" } | { kind: "budget"; period: Period };

function kindOf(text: string): Kind | null {
  if (PER_ORDER.test(text)) return { kind: "perOrder" };
  for (const [period, re] of PERIODS) if (re.test(text)) return { kind: "budget", period };
  return null;
}

/** The words right after an amount say what it is ("$5 a week"); otherwise the words before ("monthly max $15"). */
function tag(clause: string, amounts: Amount[], i: number): Kind {
  const a = amounts[i];
  const after = clause.slice(a.end, amounts[i + 1]?.start ?? clause.length).slice(0, 30);
  const before = clause.slice(amounts[i - 1]?.end ?? 0, a.start).slice(-30);
  return kindOf(after) ?? kindOf(before) ?? { kind: "budget", period: "month" };
}

const low = (l: StatedLimit) => Math.min(l.lowDollars, l.highDollars);

export function normalize(rawText: string): string {
  let t = rawText
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/(\d),(?=\d{3}\b)/g, "$1") // "$1,000" → "$1000"
    .replace(/\b(\d+(?:\.\d{1,2})?)\s*\$/g, "$$$1"); // "15$" → "$15"
  for (const [re, to] of LIMIT_PHRASES) t = t.replace(re, to);
  return t;
}

export function rulesExtract(rawText: string): Extracted {
  const clauses = normalize(rawText)
    .split(/[.;!?\n,]|\bbut\b|\bhowever\b|\band\b(?=\s+(?:no|not|never|skip|without|don'?t|do not|except|avoid|exclude)\b)/)
    .map((c) => c.trim())
    .filter(Boolean);

  const causes: CauseId[] = [];
  const optOuts: Category[] = [];
  let budget: Extracted["budget"] = null;
  let perOrder: Extracted["perOrder"] = null;

  for (const clause of clauses) {
    const negated = NEGATION.test(clause);
    for (const t of TOPICS) {
      if (!t.re.test(clause)) continue;
      if (negated && t.category) optOuts.push(t.category);
      if (!negated && t.cause) causes.push(t.cause);
    }

    const amounts = findAmounts(clause);
    amounts.forEach((a, i) => {
      const k = tag(clause, amounts, i);
      const limit = { lowDollars: a.lowDollars, highDollars: a.highDollars };
      if (k.kind === "perOrder") {
        if (!perOrder || low(limit) < low(perOrder)) perOrder = limit;
      } else {
        const monthly = (l: StatedLimit, p: Period) => toMonthlyCents(Math.round(low(l) * 100), p);
        if (!budget || monthly(limit, k.period) < monthly(budget, budget.period)) budget = { ...limit, period: k.period };
      }
    });
  }

  return { causes: unique(causes), optOutCategories: unique(optOuts), budget, perOrder };
}
