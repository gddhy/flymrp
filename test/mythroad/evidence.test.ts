import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { IMPLEMENTED_C } from "../../src/mythroad/inventory.ts";

describe("5-C API evidence", () => {
  it("evidence doc has at least 20 CONFIRMED entries", () => {
    const md = readFileSync(resolve(import.meta.dirname, "../../docs/stage5c-api-evidence.md"), "utf8");
    const confirmed = md.match(/CONFIRMED/g) ?? [];
    expect(confirmed.length).toBeGreaterThanOrEqual(20);
    expect(IMPLEMENTED_C.length).toBeGreaterThanOrEqual(15);
  });
});
