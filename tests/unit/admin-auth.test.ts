// The dev-admin fallback must never authorize payouts in production.
import { afterEach, describe, expect, it, vi } from "vitest";
import { requireAdmin } from "@/lib/api";

const req = (token?: string) => new Request("http://test/api/payouts/run", { headers: token ? { "x-admin-token": token } : {} });

afterEach(() => vi.unstubAllEnvs());

describe("requireAdmin", () => {
  it("accepts dev-admin only outside production with no ADMIN_TOKEN", () => {
    vi.stubEnv("ADMIN_TOKEN", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(() => requireAdmin(req("dev-admin"))).not.toThrow();

    vi.stubEnv("NODE_ENV", "production");
    expect(() => requireAdmin(req("dev-admin"))).toThrow("Missing or invalid x-admin-token");
    expect(() => requireAdmin(req())).toThrow("Missing or invalid x-admin-token");
  });

  it("with ADMIN_TOKEN set, only that token works (in any environment)", () => {
    vi.stubEnv("ADMIN_TOKEN", "s3cret");
    for (const env of ["development", "production"]) {
      vi.stubEnv("NODE_ENV", env);
      expect(() => requireAdmin(req("s3cret"))).not.toThrow();
      expect(() => requireAdmin(req("dev-admin"))).toThrow();
    }
  });
});
