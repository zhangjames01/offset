// Every committed mock and fixture must match its contract, so mocks can't drift.
import { describe, expect, test } from "vitest";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { Category, ClassifyRequest, ClassifyResponse, DEFAULT_CAUSE } from "@/contracts";
import {
  mockCatalog,
  mockCauses,
  mockClassifyByProduct,
  mockLedger,
  mockPreferences,
} from "@/lib/mocks";
import cartsJson from "@/tests/fixtures/carts.json";

describe("mocks/", () => {
  test("lib/mocks.ts parses every mock file (throws on import if not)", () => {
    expect(mockCatalog.products).toHaveLength(6);
    expect(mockCauses).toHaveLength(5);
  });

  test("every catalog product has a canned classify response", () => {
    for (const p of mockCatalog.products) {
      expect(mockClassifyByProduct[p.id], p.id).toBeDefined();
    }
  });

  test("every file in mocks/classify/ is a valid ClassifyResponse and is registered", () => {
    const dir = path.join(process.cwd(), "mocks/classify");
    for (const file of fs.readdirSync(dir)) {
      const json = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
      expect(ClassifyResponse.safeParse(json).success, file).toBe(true);
      expect(mockClassifyByProduct[file.replace(/\.json$/, "")], `${file} not in lib/mocks.ts`).toBeDefined();
    }
  });

  test("canned classify responses respect the demo user's caps and opt-outs", () => {
    for (const [id, r] of Object.entries(mockClassifyByProduct)) {
      expect(r.donationCents, id).toBeLessThanOrEqual(mockPreferences.perOrderMaxCents);
      expect(r.donationCents, id).toBeLessThanOrEqual(r.suggestedDonationCents);
      if (mockPreferences.optOutCategories.includes(r.category)) {
        expect(r.donationCents, id).toBe(0);
        expect(r.adjustment, id).toBe("opted_out");
      }
      expect(r.causeId, id).toBe(DEFAULT_CAUSE[r.category]);
    }
  });

  test("every category has exactly one cause", () => {
    for (const c of Category.options) {
      expect(mockCauses.filter((x) => x.categories.includes(c)), c).toHaveLength(1);
    }
  });

  test("ledger mock balances add up", () => {
    for (const b of mockLedger.balances) {
      const sum = mockLedger.entries
        .filter((e) => e.causeId === b.causeId && e.status === "pending_payout")
        .reduce((a, e) => a + e.amountCents, 0);
      expect(b.pendingCents, b.causeId).toBe(sum);
    }
  });
});

describe("tests/fixtures/carts.json", () => {
  const LabeledCart = z.object({
    id: z.string(),
    expected: z.object({ category: Category, lowConfidence: z.boolean() }),
    request: ClassifyRequest,
  });
  const Fixture = z.object({ _note: z.string().optional(), carts: z.array(LabeledCart).min(1) });

  test("is valid and ids are unique", () => {
    const parsed = Fixture.parse(cartsJson);
    const ids = parsed.carts.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("subtotals match their items", () => {
    for (const c of Fixture.parse(cartsJson).carts) {
      const sum = c.request.items.reduce((a, i) => a + i.unitPriceCents * i.quantity, 0);
      expect(c.request.subtotalCents, c.id).toBe(sum);
    }
  });
});
