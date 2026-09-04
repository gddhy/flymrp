import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MythroadRuntime } from "../../src/mythroad/index.ts";
import { CODE0_CHAIN, runCode0ChainForensics } from "../../src/real/code0chain.ts";

const REAL_APP = resolve(import.meta.dirname, "../fixtures/real/app.mrp");

describe("5-C.8 mrc_init successor BLX / mr_table", () => {
  it("after REAL_EXECUTED table[130], table[38] platEx runs; next unknown is table[40]; 0x01ea9254 is not reached", () => {
    const r = runCode0ChainForensics(new Uint8Array(readFileSync(REAL_APP)));

    expect(r.handler130).toBe(true);
    expect(r.handler38).toBe(true);
    expect(r.productionThrown).toBe("UNKNOWN_REQUIRED_SLOT = 40");
    expect(r.probeThrown).toBe("UNKNOWN_REQUIRED_SLOT = 40");
    expect(r.skipped130With).toBe(0);
    expect(r.code0Slots).toEqual([130, 14, 38, 33, 17, 40]);
    expect(r.init2Reached).toBe(false);

    expect(r.extWord0).toBe(0x00010000);
    expect(r.erRw50).toBe(0x00010038);
    expect(r.encodings.memsetLit).toBe(0x50);
    expect(r.encodings.platExLit).toBe(CODE0_CHAIN.platExCode);
    expect(r.encodings.platExBlx).toBe(0x47a0);
    expect(r.encodings.init1Mov0).toBe(0x2000);
    expect(r.encodings.init2Blx).toBe(0x47a8);
    expect(r.encodings.init2Pop).toBe(0xbd3e);

    const h14 = r.hits.find((h) => h.slot === 14);
    expect(h14).toBeDefined();
    expect(h14!.r0).toBe((h14!.r9 + CODE0_CHAIN.memsetDestOff) >>> 0);
    expect(h14!.r1).toBe(0);
    expect(h14!.r2).toBe(CODE0_CHAIN.memsetLen);
    expect(h14!.lr).toBe(0x01eab1cf);
    expect(h14!.pc).toBe(0x00010038);

    const h38 = r.hits.find((h) => h.slot === 38);
    expect(h38).toBeDefined();
    expect(h38!.r0).toBe(CODE0_CHAIN.platExCode);
    expect(h38!.r1).toBe(0);
    expect(h38!.r2).toBe(0);
    expect(h38!.r3).toBe(0);
    expect(h38!.stack0).toBe(0);
    expect(h38!.stack4).toBe(0);
    expect(h38!.pc).toBe(CODE0_CHAIN.slot38Stub);
    expect(h38!.lr).toBe(0x01ea666d);
    expect(h38!.r9).toBe(r.erRw);

    const h33 = r.hits.find((h) => h.slot === 33);
    expect(h33).toBeDefined();
    expect(h33!.pc).toBe(0x00010084);
    expect(h33!.r0).toBe(0x00010084);
    expect(h33!.lr).toBe(0x01ea7cf7);
  });

  it("does not register table[38]", () => {
    const rt = new MythroadRuntime();
    expect(rt.ext).toBeNull();
  });
});
