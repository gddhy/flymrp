import { describe, expect, it } from "vitest";
import { CREATE_ABC, OP_RETURN, dumpChunk, proto } from "../../src/lua/index.ts";
import { buildMrp } from "../../src/mrp/index.ts";
import { inspectBytes } from "../../src/real/inspect.ts";

function luaNop(): Uint8Array {
  return dumpChunk(proto({ maxstack: 2, code: [CREATE_ABC(OP_RETURN, 0, 1, 0)] }));
}

describe("5-C.1 inspect", () => {
  it("empty is INVALID", () => {
    const r = inspectBytes(new Uint8Array());
    expect(r.classification).toBe("INVALID");
    expect(r.format).toBe("empty");
  });

  it("random bytes are UNKNOWN not guessed EXT", () => {
    const r = inspectBytes(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    expect(r.classification).toBe("UNKNOWN");
    expect(r.format).toBe("unknown");
    expect(r.notes.join(" ")).toMatch(/not classified as EXT/);
  });

  it("truncated MRPG is INVALID", () => {
    const r = inspectBytes(new Uint8Array([0x4d, 0x52, 0x50, 0x47, 1, 2]));
    expect(r.classification).toBe("INVALID");
    expect(r.format).toBe("MRPG");
  });

  it("synthetic MRP is CONFIRMED and not labeled real", () => {
    const mrp = buildMrp([{ name: "start.mr", data: luaNop() }]);
    const r = inspectBytes(mrp, { fixtureKind: "synthetic" });
    expect(r.classification).toBe("CONFIRMED");
    expect(r.format).toBe("MRPG");
    expect(r.entry).toBe("start.mr");
    expect(r.luaChunks.some((c) => c.name === "start.mr")).toBe(true);
    expect(r.fixtureKind).toBe("synthetic");
  });

  it("Lua \\033MRP chunk is CONFIRMED", () => {
    const r = inspectBytes(luaNop());
    expect(r.classification).toBe("CONFIRMED");
    expect(r.format).toBe("lua-mrp");
    expect(r.luaChunks[0]!.classification).toBe("CONFIRMED");
  });

  it("MRPGCMAP header is CONFIRMED EXT", () => {
    const b = new Uint8Array(16);
    b.set([0x4d, 0x52, 0x50, 0x47, 0x43, 0x4d, 0x41, 0x50]);
    const r = inspectBytes(b);
    expect(r.classification).toBe("CONFIRMED");
    expect(r.format).toBe("ext-mrpgcmap");
  });

  it("empty ZIP is CONFIRMED container not MRP", () => {
    const z = new Uint8Array(22);
    z[0] = 0x50;
    z[1] = 0x4b;
    z[2] = 0x05;
    z[3] = 0x06;
    const r = inspectBytes(z);
    expect(r.classification).toBe("CONFIRMED");
    expect(r.format).toBe("ZIP/JAR");
    expect(r.notes.join(" ")).toMatch(/not an MRP/);
  });

  it("does not invent real-app identity", () => {
    const r = inspectBytes(buildMrp([]), { fixtureKind: "synthetic" });
    expect(r.fixtureKind).not.toBe("real");
  });
});
