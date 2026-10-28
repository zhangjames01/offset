// The JSON examples from the build plan doc (Interface contracts section).
// If a contract changes, update the doc AND this file in the same PR.
import { describe, expect, test } from "vitest";
import type { ZodType } from "zod";
import * as C from "@/contracts";
const examples: [string, ZodType, unknown][] = [
 ["Preferences", C.Preferences, {"userId":"demo-user","rawText":"I care about climate and hunger. Max $15 a month, skip packaging.","causes":["carbon_removal","food_bank"],"optOutCategories":["single_use_packaging"],"monthlyCapCents":1500,"perOrderMaxCents":500,"updatedAt":"2026-10-28T18:00:00Z"}],
 ["ClassifyRequest", C.ClassifyRequest, {"cartId":"cart_01","currency":"USD","items":[{"productId":"flight-jfk-lax","name":"JFK → LAX economy","description":"One-way flight","unitPriceCents":24900,"quantity":1}],"subtotalCents":24900,"userId":"demo-user"}],
 ["ClassifyResponse", C.ClassifyResponse, {"classificationId":"cls_01","category":"air_travel","confidence":0.94,"causeId":"carbon_removal","causeName":"Carbon removal (placeholder partner)","suggestedDonationCents":747,"donationCents":500,"rateRule":"3% of fare","reason":"Air travel is carbon-intensive, so this routes to carbon removal.","adjustment":"per_order_max","source":"llm"}],
 ["CreateOrderRequest", C.CreateOrderRequest, {"cartId":"cart_01","items":[{"productId":"flight-jfk-lax","quantity":1}],"donation":{"classificationId":"cls_01","donationCents":500,"causeId":"carbon_removal","userAction":"accepted"}}],
 ["CreateOrderResponse", C.CreateOrderResponse, { "paypalOrderId": "5O190127TN364715T", "localOrderId": "ord_01" }],
 ["CaptureResponse", C.CaptureResponse, { "status": "COMPLETED", "localOrderId": "ord_01", "ledgerEntryId": "led_01" }],
 ["LedgerEntry", C.LedgerEntry, {"id":"led_01","userId":"demo-user","localOrderId":"ord_01","paypalOrderId":"5O190127TN364715T","paypalCaptureId":"3C679366HH908993F","category":"air_travel","causeId":"carbon_removal","amountCents":500,"userAction":"accepted","classificationSource":"llm","status":"pending_payout","payoutBatchId":null,"createdAt":"2026-11-01T20:15:00Z"}],
 ["PayoutBatch", C.PayoutBatch, {"id":"pb_01","mode":"sandbox","senderBatchId":"offset-2026-11-08-001","thresholdCents":500,"items":[{"causeId":"carbon_removal","receiver":"carbon-partner@sandbox.example","amountCents":1240,"ledgerEntryIds":["led_01","led_04"]}],"paypalPayoutBatchId":"5UXD2E8A7EBQJ","status":"PENDING","createdAt":"2026-11-08T21:00:00Z"}],
 ["Cause", C.Cause, { "id": "carbon_removal", "name": "Carbon removal (placeholder partner)", "categories": ["air_travel"], "receiver": "", "impactNote": "PLACEHOLDER — no impact figure until sourced" }],
 ["ApiError", C.ApiError, {"error":{"code":"PAYPAL_CAPTURE_FAILED","message":"..."}}],
];
describe("build plan JSON examples match contracts", () => {
  for (const [name, schema, value] of examples) {
    test(name, () => {
      const r = schema.safeParse(value);
      expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    });
  }
});
