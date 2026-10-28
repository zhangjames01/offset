/**
 * Typed access to mocks/*.json. Each file is parsed against its contract on
 * load, so a drifting mock fails immediately (and in CI).
 */
import {
  CatalogResponse,
  CauseRegistry,
  ClassifyResponse,
  CaptureResponse,
  CreateOrderResponse,
  LedgerResponse,
  PayoutBatch,
  Preferences,
} from "@/contracts";

import catalogJson from "@/mocks/catalog.json";
import causesJson from "@/mocks/causes.json";
import preferencesJson from "@/mocks/preferences.json";
import ledgerJson from "@/mocks/ledger.json";
import createOrderJson from "@/mocks/paypal/create-order.json";
import captureJson from "@/mocks/paypal/capture.json";
import payoutBatchJson from "@/mocks/paypal/payout-batch.json";
import flight from "@/mocks/classify/flight-jfk-lax.json";
import tee from "@/mocks/classify/tee-3pack.json";
import ramen from "@/mocks/classify/ramen-delivery.json";
import snacks from "@/mocks/classify/snack-box.json";
import novel from "@/mocks/classify/paperback-novel.json";
import giftCard from "@/mocks/classify/gift-card-50.json";

export const mockCatalog = CatalogResponse.parse(catalogJson);
export const mockCauses = CauseRegistry.parse(causesJson);
export const mockPreferences = Preferences.parse(preferencesJson);
export const mockLedger = LedgerResponse.parse(ledgerJson);
export const mockCreateOrder = CreateOrderResponse.parse(createOrderJson);
export const mockCapture = CaptureResponse.parse(captureJson);
export const mockPayoutBatch = PayoutBatch.parse(payoutBatchJson);

/** Canned ClassifyResponse per catalog productId. */
export const mockClassifyByProduct: Record<string, ClassifyResponse> = {
  "flight-jfk-lax": ClassifyResponse.parse(flight),
  "tee-3pack": ClassifyResponse.parse(tee),
  "ramen-delivery": ClassifyResponse.parse(ramen),
  "snack-box": ClassifyResponse.parse(snacks),
  "paperback-novel": ClassifyResponse.parse(novel),
  "gift-card-50": ClassifyResponse.parse(giftCard),
};

/** Used for products with no canned response. */
export const mockUnknownProduct: ClassifyResponse = {
  ...mockClassifyByProduct["gift-card-50"],
  classificationId: "cls_mock_unknown",
  reason: "No canned mock for this product, so this uses a small general donation.",
};
