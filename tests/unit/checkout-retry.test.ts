
import {
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";

import { POST } from "@/app/api/checkout/create-order/route";
import { createPayPalOrder } from "@/lib/paypal/client";
import { mockCatalog, mockPreferences } from "@/lib/mocks";
import { hashCart } from "@/lib/checkout/cart-hash";
import { hashCheckoutRequest } from "@/lib/checkout/request-hash";

vi.mock("next/server", () => ({
  connection: async () => {},
}));

vi.mock("@/lib/paypal/client", () => ({
  createPayPalOrder: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getPrisma: () => prisma,
}));

const paypalMock = vi.mocked(createPayPalOrder);
const product = mockCatalog.products[0];

const checkoutBody = {
  cartId: "cart_retry_test",
  items: [
    { productId: product.id, quantity: 1 },
  ],
  donation: {
    classificationId: "cls_retry_test",
    donationCents: 100,
    causeId: "general_fund" as const,
    userAction: "accepted" as const,
  },
};

type Attempt = {
  id: string;
  userId: string;
  cartId: string;
  requestHash: string;
  status: string;
  paypalOrderId: string | null;
  localOrderId: string;
};

let attempt: Attempt | null;
let savedOrder: { id: string; paypalOrderId: string } | null;
let failTransaction: boolean;

const classification = {
  id: checkoutBody.donation.classificationId,
  userId: mockPreferences.userId,
  cartId: checkoutBody.cartId,
  cartHash: hashCart([
    {
      productId: product.id,
      quantity: 1,
      priceCents: product.priceCents,
    },
  ]),
  category: "general",
  causeId: checkoutBody.donation.causeId,
  donationCents: 100,
  source: "llm",
};

const tx = {
  order: {
    create: vi.fn(async ({ data }: {
      data: { id: string; paypalOrderId: string };
    }) => {
      savedOrder = {
        id: data.id,
        paypalOrderId: data.paypalOrderId,
      };
    }),
  },
  checkoutAttempt: {
    update: vi.fn(async ({ data }: {
      data: { status: string; paypalOrderId: string };
    }) => {
      if (!attempt) throw new Error("Missing attempt");
      attempt.status = data.status;
      attempt.paypalOrderId = data.paypalOrderId;
    }),
  },
};

const prisma = {
  classificationApproval: {
    findUnique: vi.fn(async () => classification),
  },
  preferences: {
    findUnique: vi.fn(async () => ({
      perOrderMaxCents: 1000,
      monthlyCapCents: 10000,
    })),
  },
  ledgerEntry: {
    aggregate: vi.fn(async () => ({
      _sum: { amountCents: 0 },
    })),
  },
  checkoutAttempt: {
    createMany: vi.fn(async ({ data }: {
      data: Array<{
        userId: string;
        cartId: string;
        requestHash: string;
        status: string;
        localOrderId: string;
      }>;
    }) => {
      if (attempt) return { count: 0 };

      attempt = {
        id: "attempt_1",
        ...data[0],
        paypalOrderId: null,
      };
      return { count: 1 };
    }),
    findUniqueOrThrow: vi.fn(async () => {
      if (!attempt) throw new Error("Missing attempt");
      return { ...attempt };
    }),
    updateMany: vi.fn(async ({ where, data }: {
      where: {
        id: string;
        status: string;
        requestHash?: string;
      };
      data: { status: string };
    }) => {
      if (
        !attempt ||
        attempt.id !== where.id ||
        attempt.status !== where.status ||
        (where.requestHash !== undefined &&
          attempt.requestHash !== where.requestHash)
      ) {
        return { count: 0 };
      }

      attempt.status = data.status;
      return { count: 1 };
    }),
  },
  $transaction: vi.fn(async (
    callback: (client: typeof tx) => Promise<unknown>,
  ) => {
    if (failTransaction) {
      throw new Error("Simulated Neon failure");
    }
    return callback(tx);
  }),
};

async function checkout(
  body: typeof checkoutBody = checkoutBody,
) {
  const response = await POST(
    new Request(
      "http://localhost:3000/api/checkout/create-order",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    ),
  );

  return {
    status: response.status,
    body: await response.json(),
  };
}

beforeEach(() => {
  vi.stubEnv("PAYPAL_MODE", "sandbox");

  attempt = null;
  savedOrder = null;
  failTransaction = false;

  vi.clearAllMocks();

  paypalMock.mockResolvedValue("PAYPAL_TEST_123");
});

describe("J3 checkout retry protection", () => {
  test("creates and persists an order", async () => {
    const result = await checkout();

    expect(result.status).toBe(201);
    expect(result.body.paypalOrderId)
      .toBe("PAYPAL_TEST_123");

    expect(savedOrder?.paypalOrderId)
      .toBe("PAYPAL_TEST_123");

    expect(attempt?.status).toBe("CREATED");
    expect(attempt?.paypalOrderId)
      .toBe("PAYPAL_TEST_123");

    expect(prisma.$transaction)
      .toHaveBeenCalledOnce();
  });

  test("identical retry returns the same order", async () => {
    const first = await checkout();
    const second = await checkout();

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);

    expect(paypalMock).toHaveBeenCalledOnce();
  });

  test("PayPal failure releases the attempt", async () => {
    paypalMock
      .mockRejectedValueOnce(new Error("PayPal unavailable"))
      .mockResolvedValueOnce("PAYPAL_RECOVERED");

    const first = await checkout();

    expect(first.status).toBe(502);
    expect(attempt?.status).toBe("PENDING");

    const originalId = attempt?.localOrderId;

    const second = await checkout();

    expect(second.status).toBe(201);
    expect(second.body.paypalOrderId)
      .toBe("PAYPAL_RECOVERED");
    expect(second.body.localOrderId)
      .toBe(originalId);

    expect(paypalMock.mock.calls[0][1])
      .toBe(originalId);
    expect(paypalMock.mock.calls[1][1])
      .toBe(originalId);
  });

  test("Neon failure releases the attempt", async () => {
    failTransaction = true;

    const first = await checkout();

    expect(first.status).toBe(500);
    expect(attempt?.status).toBe("PENDING");

    const originalId = attempt?.localOrderId;

    failTransaction = false;

    const second = await checkout();

    expect(second.status).toBe(201);
    expect(second.body.localOrderId)
      .toBe(originalId);
    expect(attempt?.status).toBe("CREATED");

    expect(paypalMock.mock.calls[0][1])
      .toBe(originalId);
    expect(paypalMock.mock.calls[1][1])
      .toBe(originalId);
  });

  test("changed request is rejected", async () => {
    await checkout();

    const changed = {
      ...checkoutBody,
      donation: {
        ...checkoutBody.donation,
        donationCents: 101,
      },
    };

    const result = await checkout(changed);

    expect(result.status).toBe(400);
    expect(paypalMock).toHaveBeenCalledOnce();
  });

  test("concurrent request cannot claim twice", async () => {
    let release!: (id: string) => void;

    paypalMock.mockImplementationOnce(
      () => new Promise<string>((resolve) => {
        release = resolve;
      }),
    );

    const firstPromise = checkout();

    // Wait until the first request reaches PayPal.
    await vi.waitFor(() => {
      expect(paypalMock).toHaveBeenCalledOnce();
    });

    const second = await checkout();

    expect(second.status).toBe(409);
    expect(paypalMock).toHaveBeenCalledOnce();

    release("PAYPAL_TEST_123");

    const first = await firstPromise;

    expect(first.status).toBe(201);
    expect(attempt?.status).toBe("CREATED");
  });

  test("request hash stays stable for identical input", () => {
    expect(hashCheckoutRequest(checkoutBody))
      .toBe(hashCheckoutRequest(checkoutBody));
  });
});
