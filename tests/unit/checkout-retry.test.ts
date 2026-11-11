import { beforeEach, describe, expect, test, vi } from "vitest";

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
  items: [{ productId: product.id, quantity: 1 }],
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
  processingToken: string | null;
  localOrderId: string;
  updatedAt: Date;
};

let attempts: Attempt[];
const latestAttempt = () => attempts.at(-1);
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
    create: vi.fn(
      async ({ data }: { data: { id: string; paypalOrderId: string } }) => {
        savedOrder = {
          id: data.id,
          paypalOrderId: data.paypalOrderId,
        };
      },
    ),
  },

  checkoutAttempt: {
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where: {
          id: string;
          status: string;
          processingToken: string;
        };
        data: {
          status: string;
          paypalOrderId: string;
          processingToken: null;
        };
      }) => {
        const found = attempts.find(
          (a) =>
            a.id === where.id &&
            a.status === where.status &&
            a.processingToken === where.processingToken,
        );

        if (!found) {
          return { count: 0 };
        }

        found.status = data.status;
        found.paypalOrderId = data.paypalOrderId;
        found.processingToken = data.processingToken;

        return { count: 1 };
      },
    ),
  },
};

const prisma = {
  classificationApproval: {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
      where.id === classification.id || where.id === "cls_reclassified"
        ? { ...classification, id: where.id }
        : null,
    ),
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
    createMany: vi.fn(
      async ({
        data,
      }: {
        data: Array<{
          userId: string;
          cartId: string;
          requestHash: string;
          status: string;
          localOrderId: string;
        }>;
      }) => {
        let count = 0;
        for (const entry of data) {
          if (
            attempts.some(
              (a) =>
                a.userId === entry.userId &&
                a.cartId === entry.cartId &&
                a.requestHash === entry.requestHash,
            )
          ) {
            continue;
          }
          attempts.push({
            id: `attempt_${attempts.length + 1}`,
            ...entry,
            paypalOrderId: null,
            processingToken: null,
            updatedAt: new Date(),
          });
          count++;
        }
        return { count };
      },
    ),
    findUniqueOrThrow: vi.fn(
      async ({
        where,
      }: {
        where: {
          userId_cartId_requestHash: {
            userId: string;
            cartId: string;
            requestHash: string;
          };
        };
      }) => {
        const key = where.userId_cartId_requestHash;
        const found = attempts.find(
          (a) =>
            a.userId === key.userId &&
            a.cartId === key.cartId &&
            a.requestHash === key.requestHash,
        );
        if (!found) throw new Error("Missing attempt");
        return { ...found };
      },
    ),

    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where: {
          id: string;
          requestHash?: string;
          status?: string;
          processingToken?: string;
          OR?: Array<
            { status: string } | { status: string; updatedAt: { lt: Date } }
          >;
        };
        data: {
          status: string;
          processingToken?: string | null;
          updatedAt?: Date;
        };
      }) => {
        const found = attempts.find((a) => {
          if (a.id !== where.id) return false;

          if (
            where.requestHash !== undefined &&
            a.requestHash !== where.requestHash
          ) {
            return false;
          }

          if (where.status !== undefined && a.status !== where.status) {
            return false;
          }

          if (
            where.processingToken !== undefined &&
            a.processingToken !== where.processingToken
          ) {
            return false;
          }

          if (where.OR) {
            const matches = where.OR.some((condition) => {
              if (a.status !== condition.status) return false;

              if ("updatedAt" in condition) {
                return a.updatedAt < condition.updatedAt.lt;
              }

              return true;
            });

            if (!matches) return false;
          }

          return true;
        });

        if (!found) return { count: 0 };

        found.status = data.status;

        if (data.processingToken !== undefined) {
          found.processingToken = data.processingToken;
        }

        found.updatedAt = data.updatedAt ?? new Date();

        return { count: 1 };
      },
    ),
  },
  $transaction: vi.fn(
    async (callback: (client: typeof tx) => Promise<unknown>) => {
      if (failTransaction) {
        throw new Error("Simulated Neon failure");
      }
      return callback(tx);
    },
  ),
};

type CheckoutBody = Omit<typeof checkoutBody, "donation"> & {
  donation: Omit<typeof checkoutBody.donation, "userAction"> & {
    userAction: "accepted" | "edited" | "removed";
  };
};

async function checkout(body: CheckoutBody = checkoutBody) {
  const response = await POST(
    new Request("http://localhost:3000/api/checkout/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

  return {
    status: response.status,
    body: await response.json(),
  };
}

beforeEach(() => {
  vi.stubEnv("PAYPAL_MODE", "sandbox");

  attempts = [];
  savedOrder = null;
  failTransaction = false;

  vi.clearAllMocks();

  paypalMock.mockResolvedValue("PAYPAL_TEST_123");
});

describe("J3 checkout retry protection", () => {
  test("creates and persists an order", async () => {
    const result = await checkout();

    expect(result.status).toBe(201);
    expect(result.body.paypalOrderId).toBe("PAYPAL_TEST_123");

    expect(savedOrder?.paypalOrderId).toBe("PAYPAL_TEST_123");

    expect(latestAttempt()?.status).toBe("CREATED");
    expect(latestAttempt()?.paypalOrderId).toBe("PAYPAL_TEST_123");

    expect(prisma.$transaction).toHaveBeenCalledOnce();
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
    expect(latestAttempt()?.status).toBe("PENDING");

    const originalId = latestAttempt()?.localOrderId;

    const second = await checkout();

    expect(second.status).toBe(201);
    expect(second.body.paypalOrderId).toBe("PAYPAL_RECOVERED");
    expect(second.body.localOrderId).toBe(originalId);

    expect(paypalMock.mock.calls[0][2]).toBe(originalId);
    expect(paypalMock.mock.calls[1][2]).toBe(originalId);
  });

  test("Neon failure releases the attempt", async () => {
    failTransaction = true;

    const first = await checkout();

    expect(first.status).toBe(500);
    expect(latestAttempt()?.status).toBe("PENDING");

    const originalId = latestAttempt()?.localOrderId;

    failTransaction = false;

    const second = await checkout();

    expect(second.status).toBe(201);
    expect(second.body.localOrderId).toBe(originalId);
    expect(latestAttempt()?.status).toBe("CREATED");

    expect(paypalMock.mock.calls[0][2]).toBe(originalId);
    expect(paypalMock.mock.calls[1][2]).toBe(originalId);
  });

  test("changed accepted donation is rejected", async () => {
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

  test("edited donation creates a new checkout attempt", async () => {
    const first = await checkout();
    const edited = {
      ...checkoutBody,
      donation: {
        ...checkoutBody.donation,
        donationCents: 150,
        userAction: "edited" as const,
      },
    };
    paypalMock.mockResolvedValueOnce("PAYPAL_EDITED");
    const second = await checkout(edited);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.paypalOrderId).toBe("PAYPAL_EDITED");
    expect(second.body.localOrderId).not.toBe(first.body.localOrderId);
    expect(attempts).toHaveLength(2);
    expect(paypalMock).toHaveBeenCalledTimes(2);
  });

  test("removed donation creates a new checkout attempt", async () => {
    const first = await checkout();
    const removed = {
      ...checkoutBody,
      donation: {
        ...checkoutBody.donation,
        donationCents: 0,
        userAction: "removed" as const,
      },
    };
    const second = await checkout(removed);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.localOrderId).not.toBe(first.body.localOrderId);
    expect(attempts).toHaveLength(2);
  });

  test("new classification ID creates a new checkout attempt", async () => {
    const first = await checkout();
    const reclassified = {
      ...checkoutBody,
      donation: {
        ...checkoutBody.donation,
        classificationId: "cls_reclassified",
      },
    };
    const second = await checkout(reclassified);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.localOrderId).not.toBe(first.body.localOrderId);
    expect(attempts).toHaveLength(2);
  });

  test("concurrent request cannot claim twice", async () => {
    let release!: (id: string) => void;

    paypalMock.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
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
    expect(latestAttempt()?.status).toBe("CREATED");
  });

  test("request hash stays stable for identical input", () => {
    expect(hashCheckoutRequest(checkoutBody)).toBe(
      hashCheckoutRequest(checkoutBody),
    );
  });

  test("stale PROCESSING attempt can be retried", async () => {
    const requestHash = hashCheckoutRequest(checkoutBody);

    attempts.push({
      id: "attempt_stale",
      userId: mockPreferences.userId,
      cartId: checkoutBody.cartId,
      requestHash,
      status: "PROCESSING",
      paypalOrderId: null,
      localOrderId: "ord_original",
      processingToken: "old_processing_token",
      updatedAt: new Date(Date.now() - 60_000),
    });

    const result = await checkout();

    expect(result.status).toBe(201);
    expect(result.body.localOrderId).toBe("ord_original");
    expect(paypalMock).toHaveBeenCalledOnce();
    expect(paypalMock.mock.calls[0][2]).toBe("ord_original");
    expect(latestAttempt()?.status).toBe("CREATED");
  });

  test("older request cannot finalize after a stale retry", async () => {
    let releaseFirst!: (id: string) => void;

    paypalMock.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          releaseFirst = resolve;
        }),
    );

    const firstPromise = checkout();

    await vi.waitFor(() => {
      expect(paypalMock).toHaveBeenCalledOnce();
    });

    const attempt = latestAttempt();
    expect(attempt?.status).toBe("PROCESSING");

    // Make the first request eligible for a stale retry.
    attempt!.updatedAt = new Date(Date.now() - 60_000);

    paypalMock.mockResolvedValueOnce("PAYPAL_TEST_123");

    const second = await checkout();

    expect(second.status).toBe(201);
    expect(latestAttempt()?.status).toBe("CREATED");

    // The older request finishes after ownership has changed.
    releaseFirst("PAYPAL_TEST_123");

    const first = await firstPromise;

    expect(first.status).toBe(409);
    expect(tx.order.create).toHaveBeenCalledOnce();
    expect(latestAttempt()?.status).toBe("CREATED");
  });
});
