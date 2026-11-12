import { centsToUsd, getAccessToken } from "./client";

const PAYPAL_BASE_URL = "https://api-m.sandbox.paypal.com";

export class DefinitivePayoutRejection extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DefinitivePayoutRejection";
  }
}

export type SandboxPayoutItem = {
  causeId: string;
  receiver: string;
  amountCents: number;
};

export type SandboxPayoutItemStatus = {
  senderItemId: string;
  payoutItemId: string;
  status: string;
  receiver: string;
};

export type SandboxPayoutResult = {
  paypalPayoutBatchId: string;
  status: "PENDING" | "PROCESSING" | "SUCCESS" | "DENIED" | "CANCELED";
  items?: SandboxPayoutItemStatus[];
};

type PayPalPayoutResponse = {
  batch_header?: {
    payout_batch_id?: string;
    batch_status?: string;
  };
  items?: Array<{
    payout_item_id?: string;
    transaction_status?: string;
    payout_item?: {
      sender_item_id?: string;
      receiver?: string;
    };
  }>;
};

/**
 * Submit a payout batch to PayPal Sandbox.
 *
 * senderBatchId must be stable across retries.
 * Never generate a new ID when retrying the same batch.
 */
export async function createSandboxPayout(
  senderBatchId: string,
  items: SandboxPayoutItem[],
  providedAccessToken?: string,
): Promise<SandboxPayoutResult> {
  if (!senderBatchId.trim()) {
    throw new Error("Missing payout sender batch ID");
  }

  if (items.length === 0) {
    throw new Error("Cannot submit an empty payout batch");
  }

  for (const item of items) {
    if (
      !item.receiver.trim() ||
      !Number.isSafeInteger(item.amountCents) ||
      item.amountCents <= 0
    ) {
      throw new Error("Invalid payout item");
    }
  }

  const accessToken = providedAccessToken ?? (await getAccessToken());
  const response = await fetch(`${PAYPAL_BASE_URL}/v1/payments/payouts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender_batch_header: {
        sender_batch_id: senderBatchId,
        email_subject: "You have received a payout from Offset",
        email_message: "Offset has sent you a donation payout.",
      },
      items: items.map((item) => ({
        recipient_type: "EMAIL",
        receiver: item.receiver,
        amount: {
          value: centsToUsd(item.amountCents),
          currency: "USD",
        },
        sender_item_id: `${senderBatchId}-${item.causeId}`,
        note: `Offset donation payout for ${item.causeId}`,
      })),
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const details = await response.text();

    let errorName: string | undefined;

    try {
      const parsed: unknown = JSON.parse(details);

      if (
        parsed !== null &&
        typeof parsed === "object" &&
        "name" in parsed &&
        typeof parsed.name === "string"
      ) {
        errorName = parsed.name;
      }
    } catch {
      // Unrecognized responses remain ambiguous.
    }

    const message = `PayPal payout failed: ${response.status} ${details.slice(0, 500)}`;

    // Only explicitly recognized request validation failures
    // are treated as definitive non-submissions.
    if (
      (response.status === 400 || response.status === 422) &&
      (errorName === "INVALID_REQUEST" || errorName === "VALIDATION_ERROR")
    ) {
      throw new DefinitivePayoutRejection(message);
    }

    throw new Error(message);
  }

  const data: PayPalPayoutResponse = await response.json();

  const batchId = data.batch_header?.payout_batch_id;
  const rawStatus = data.batch_header?.batch_status;

  if (!batchId) {
    throw new Error("PayPal returned no payout batch ID");
  }

  const validStatuses = [
    "PENDING",
    "PROCESSING",
    "SUCCESS",
    "DENIED",
    "CANCELED",
  ] as const;

  const status =
    rawStatus === "NEW"
      ? "PENDING"
      : validStatuses.find((s) => s === rawStatus);
  if (!status) {
    throw new Error(`Unexpected PayPal payout status: ${rawStatus}`);
  }

  return {
    paypalPayoutBatchId: batchId,
    status,
  };
}

export async function getSandboxPayout(
  paypalPayoutBatchId: string,
): Promise<SandboxPayoutResult> {
  if (!paypalPayoutBatchId.trim()) {
    throw new Error("Missing PayPal payout batch ID");
  }

  const accessToken = await getAccessToken();

  const response = await fetch(
    `${PAYPAL_BASE_URL}/v1/payments/payouts/${encodeURIComponent(paypalPayoutBatchId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const details = await response.text();

    throw new Error(
      `PayPal payout lookup failed: ${response.status} ${details.slice(0, 500)}`,
    );
  }

  const data: PayPalPayoutResponse = await response.json();

  const batchId = data.batch_header?.payout_batch_id;
  const rawStatus = data.batch_header?.batch_status;

  if (!batchId) {
    throw new Error("PayPal returned no payout batch ID");
  }

  const validStatuses = [
    "PENDING",
    "PROCESSING",
    "SUCCESS",
    "DENIED",
    "CANCELED",
  ] as const;

  const status =
    rawStatus === "NEW"
      ? "PENDING"
      : validStatuses.find((s) => s === rawStatus);
  if (!status) {
    throw new Error(`Unexpected PayPal payout status: ${rawStatus}`);
  }

  const items: SandboxPayoutItemStatus[] = (data.items ?? []).map((item) => ({
    senderItemId: item.payout_item?.sender_item_id ?? "",
    payoutItemId: item.payout_item_id ?? "",
    status: item.transaction_status ?? "UNKNOWN",
    receiver: item.payout_item?.receiver ?? "",
  }));

  return {
    paypalPayoutBatchId: batchId,
    status,
    items,
  };
}
