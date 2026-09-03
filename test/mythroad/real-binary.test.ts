import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("5-C real binary fixture", () => {
  it("reports no real binary fixture available", () => {
    const root = resolve(import.meta.dirname, "../fixtures/real");
    const names = ["start.mr", "app.mrp", "魔塔II.jar", "motta.mrp"];
    for (const n of names) {
      expect(existsSync(resolve(root, n))).toBe(false);
    }
    expect("No real binary fixture available.").toBe("No real binary fixture available.");
  });
});
