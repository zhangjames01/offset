
import { describe, expect, test } from "vitest";
import { centsToUsd } from "@/lib/paypal/client";

describe("PayPal amount formatting", () => {
  test("converts cents to USD", () => {
    expect(centsToUsd(100)).toBe("1.00");
    expect(centsToUsd(1050)).toBe("10.50");
    expect(centsToUsd(99)).toBe("0.99");
    expect(centsToUsd(0)).toBe("0.00");
  });

  test("rejects invalid amounts", () => {
    expect(() => centsToUsd(-1)).toThrow();
    expect(() => centsToUsd(1.5)).toThrow();
    expect(() => centsToUsd(Number.NaN)).toThrow();
  });
});
