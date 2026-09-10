import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { REAL_MRP_BASELINE } from "../../src/real/startup.ts";
import { runInflateWindowDiff } from "./inflate-window.ts";

const REAL_APP = resolve(import.meta.dirname, "../fixtures/real/app.mrp");
const heavy = process.env.FLYRMP_HEAVY === "1";

describe.skipIf(!heavy)("5-C.10Q inflate hot-region Unicorn window", () => {
  it("100/1000/10000 insns from the 1M stop match Unicorn", async () => {
    expect(existsSync(REAL_APP)).toBe(true);
    const bytes = new Uint8Array(readFileSync(REAL_APP));
    const r = await runInflateWindowDiff(bytes, [100, 1000, 10_000]);
    expect(r.startPc).toBe(REAL_MRP_BASELINE.budgetStopPc);
    for (const p of r.points) {
      expect(p.uni?.error ?? null, `${p.count}: ${p.mismatch.join("; ")}`).toBeNull();
      expect(p.mismatch, `${p.count}`).toEqual([]);
    }
  }, 180_000);
});
