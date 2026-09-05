import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CREATE_ABC, CREATE_ABx, OP_CALL, OP_GETGLOBAL, OP_RETURN, dumpChunk, proto } from "../../src/lua/index.ts";
import { buildMrp } from "../../src/mrp/index.ts";
import { MythroadRuntime, RuntimeTrace } from "../../src/mythroad/index.ts";
import { anyReady, discoverRealBinaries, loaderReadiness, runCompatibilityGate } from "../../src/real/index.ts";
import { ks } from "../helpers/lua.ts";

describe("5-C.1 compatibility gate", () => {
  it("no binary is REAL_BINARY_BLOCKED", () => {
    const r = runCompatibilityGate();
    expect(r.status).toBe("REAL_BINARY_BLOCKED");
    expect(r.realAppGreen).toBe(false);
    expect(r.notes.join(" ")).toMatch(/REAL_BINARY_BLOCKED/);
  });

  it("test/fixtures/real discovers app.mrp only", () => {
    const found = discoverRealBinaries(resolve(import.meta.dirname, "../fixtures/real"));
    expect(found).toHaveLength(1);
    expect(found[0]!.endsWith("app.mrp")).toBe(true);
  });

  it("readiness has no READY rows", () => {
    const items = loaderReadiness();
    expect(anyReady(items)).toBe(false);
    expect(items.every((i) => i.status === "PARTIAL" || i.status === "BLOCKED")).toBe(true);
    expect(items.some((i) => i.item.includes("real start.mr") && i.status === "PARTIAL")).toBe(true);
    expect(items.some((i) => i.status === "BLOCKED" && i.reason.includes("DRM"))).toBe(true);
  });

  it("synthetic MRP is SYNTHETIC_ONLY not real-app green", () => {
    const start = dumpChunk(
      proto({
        maxstack: 3,
        k: [ks("GetSysInfo")],
        code: [CREATE_ABx(OP_GETGLOBAL, 0, 0), CREATE_ABC(OP_CALL, 0, 1, 2), CREATE_ABC(OP_RETURN, 0, 1, 0)],
      }),
    );
    const r = runCompatibilityGate({ bytes: buildMrp([{ name: "start.mr", data: start }]), fixtureKind: "synthetic" });
    expect(r.status).toBe("SYNTHETIC_ONLY");
    expect(r.realAppGreen).toBe(false);
    expect(r.inspect?.classification).toBe("CONFIRMED");
    expect(r.startup).toBe("pass");
    expect(r.fixtureKind).toBe("synthetic");
  });

  it("real app.mrp is INSPECTED and not green", () => {
    const path = resolve(import.meta.dirname, "../fixtures/real/app.mrp");
    const r = runCompatibilityGate({ path, fixtureKind: "real", steps: 0 });
    expect(r.status).toBe("INSPECTED");
    expect(r.realAppGreen).toBe(false);
    expect(r.inspect?.classification).toBe("CONFIRMED");
    expect(r.inspect?.format).toBe("MRPG");
    expect(r.inspect?.entry).toBe("start.mr");
    expect(r.startup).toBe("fail");
    expect(r.failure?.message).toMatch(/unsupported mr_open filename/);
    expect(r.nativeAbi.unknown.some((e) => e.family === "mr_open")).toBe(true);
  });

  it("unknown bytes do not become a fake app pass", () => {
    const r = runCompatibilityGate({ bytes: new Uint8Array([9, 9, 9, 9]), fixtureKind: "synthetic" });
    expect(r.startup).toBe("fail");
    expect(r.realAppGreen).toBe(false);
  });
});

describe("5-C.1 trace overhead", () => {
  it("traced GetSysInfo stays the same ABI", () => {
    const a = new MythroadRuntime();
    const b = new MythroadRuntime({ trace: new RuntimeTrace() });
    const call = (rt: MythroadRuntime) => {
      rt.lua.runCold(
        proto({
          maxstack: 3,
          k: [ks("GetSysInfo")],
          code: [CREATE_ABx(OP_GETGLOBAL, 0, 0), CREATE_ABC(OP_CALL, 0, 1, 2), CREATE_ABC(OP_RETURN, 0, 1, 0)],
        }),
      );
    };
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) call(a);
    const off = performance.now() - t0;
    const t1 = performance.now();
    for (let i = 0; i < 200; i++) call(b);
    const on = performance.now() - t1;
    expect(b.trace!.records.length).toBeGreaterThan(0);
    expect(a.trace).toBeNull();
    expect(on).toBeGreaterThan(0);
    expect(off).toBeGreaterThan(0);
  });
});
