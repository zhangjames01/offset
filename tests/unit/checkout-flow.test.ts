// H4: the body the checkout page sends goes through classify → create-order → capture → ledger (mock mode).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CaptureResponse, ClassifyResponse, CreateOrderResponse, LedgerResponse } from "@/contracts";
import { cartReducer, emptyCart, toClassifyRequest } from "@/lib/cart";
import { defaultDecision, toCreateOrderRequest } from "@/lib/donation";
import { mockCatalog } from "@/lib/mocks";
import { resetStore } from "@/lib/mock-store";

vi.mock("next/server", () => ({ connection: async () => {} }));

import { POST as classify } from "@/app/api/classify/route";
import { POST as createOrder } from "@/app/api/checkout/create-order/route";
import { POST as capture } from "@/app/api/checkout/capture/route";
import { GET as getLedger } from "@/app/api/ledger/route";

const post = (body: unknown) =>
  new Request("http://test/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => resetStore());

describe("checkout flow from the UI's request bodies", () => {
  const cart = cartReducer(emptyCart("cart_flow"), { type: "add", product: mockCatalog.products[0] }); // flight

  async function pay(action: "accepted" | "removed") {
    const cls = ClassifyResponse.parse(await (await classify(post(toClassifyRequest(cart)))).json());
    const d = action === "accepted" ? defaultDecision(cls) : { action, cents: 0 };
    const res = await createOrder(post(toCreateOrderRequest(cart, cls, d)));
    expect(res.status).toBe(201);
    const { paypalOrderId } = CreateOrderResponse.parse(await res.json());
    return CaptureResponse.parse(await (await capture(post({ paypalOrderId }))).json());
  }

  it("accepted donation writes one ledger entry", async () => {
    const r = await pay("accepted");
    expect(r.ledgerEntryId).not.toBeNull();
    const ledger = LedgerResponse.parse(await (await getLedger()).json());
    expect(ledger.entries.find((e) => e.id === r.ledgerEntryId)?.amountCents).toBe(500);
  });

  it("removed donation captures with no ledger entry", async () => {
    expect((await pay("removed")).ledgerEntryId).toBeNull();
  });
});
