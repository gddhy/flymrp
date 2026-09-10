import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { sha256hex } from "../../src/real/inspect.ts";

const REAL_APP = resolve(import.meta.dirname, "../fixtures/real/app.mrp");
const REAL_SHA = "77487205cd4db95fcf104392d9cc692ab122b06f7a04e14f49899277d9ac4263";

describe("5-C real binary fixture", () => {
  it("records the user-supplied app.mrp identity without claiming green", () => {
    expect(existsSync(REAL_APP)).toBe(true);
    const bytes = new Uint8Array(readFileSync(REAL_APP));
    expect(sha256hex(bytes)).toBe(REAL_SHA);
    expect(bytes.length).toBe(382778);
    expect(String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!)).toBe("MRPG");
    expect(existsSync(resolve(import.meta.dirname, "../fixtures/real/魔塔II.jar"))).toBe(false);
    expect(existsSync(resolve(import.meta.dirname, "../fixtures/real/motta.mrp"))).toBe(false);
  });
});
