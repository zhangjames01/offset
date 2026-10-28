/**
 * In-memory state for MOCK mode only, so the full demo flow
 * (classify → create-order → capture → ledger → payout) works before the DB exists.
 * Resets when the server restarts. Jay replaces this with Prisma in J2–J7.
 */
import type {
  ClassifyResponse,
  CreateOrderRequest,
  LedgerEntry,
  PayoutBatch,
  Preferences,
} from "@/contracts";
import { mockLedger, mockPreferences } from "./mocks";

type MockOrder = {
  paypalOrderId: string;
  localOrderId: string;
  donation: CreateOrderRequest["donation"];
  captured: { ledgerEntryId: string | null } | null;
};

type Store = {
  seq: number;
  preferences: Preferences;
  classifications: Map<string, ClassifyResponse>;
  orders: Map<string, MockOrder>;
  ledger: LedgerEntry[];
  batches: Map<string, PayoutBatch>;
};

function fresh(): Store {
  return {
    seq: 100,
    preferences: structuredClone(mockPreferences),
    classifications: new Map(),
    orders: new Map(),
    ledger: structuredClone(mockLedger.entries),
    batches: new Map(),
  };
}

// globalThis keeps one store across route modules and dev hot reloads.
const g = globalThis as unknown as { __offsetMockStore?: Store };

export function store(): Store {
  g.__offsetMockStore ??= fresh();
  return g.__offsetMockStore;
}

/** For tests. */
export function resetStore(): void {
  g.__offsetMockStore = fresh();
}

export function nextId(prefix: string): string {
  const s = store();
  s.seq += 1;
  return `${prefix}${s.seq}`;
}
