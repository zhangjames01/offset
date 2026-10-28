// GET /api/catalog — owner: Jay. Demo products.
import { CatalogResponse } from "@/contracts";
import { handle, ok } from "@/lib/api";
import { mockCatalog } from "@/lib/mocks";

export const GET = handle(async () => {
  // Static in every mode: the catalog is committed data (DB seed loads the same file).
  return ok(CatalogResponse, mockCatalog);
});
