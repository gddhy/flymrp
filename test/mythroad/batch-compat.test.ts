import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ExtRuntime } from "../../src/abi/runtime.ts";
import { EXT_STOP_ADDR, tableSlotAddr } from "../../src/abi/layout.ts";
import { MrTableBridge } from "../../src/mythroad/mr-table.ts";
import { MythroadVfs } from "../../src/mythroad/vfs.ts";
import { MythroadRuntime } from "../../src/mythroad/runtime.ts";
import { CREATE_ABC, CREATE_ABx, OP_CALL, OP_GETGLOBAL, OP_LOADK, OP_RETURN, OP_ADD, dumpChunk, proto } from "../../src/lua/index.ts";
import { buildMrp } from "../../src/mrp/build.ts";
import { gzipStore } from "../../src/mrp/gzip.ts";
import { guestPrintf, guestSprintf } from "../../src/mythroad/sprintf.ts";
import { invoke, kn, ks, resultNum } from "../helpers/lua.ts";

function wire() {
  const ext = new ExtRuntime();
  const bridge = new MrTableBridge(ext, new MythroadVfs(), "test", { getPack: () => ({ name: "test.mrp", bytes: new Uint8Array(12) }) });
  bridge.install();
  const call = (slot: number, r0 = 0, r1 = 0, r2 = 0, r3 = 0) => {
    const out = ext.runGuest(tableSlotAddr(slot), { r0, r1, r2, r3, lr: EXT_STOP_ADDR });
    expect(out.kind).toBe("return");
    return out.r0 | 0;
  };
  const str = (s: string) => { const p = ext.alloc(s.length + 1); ext.mem.load(p, new TextEncoder().encode(s + "\0")); return p; };
  return { ext, bridge, call, str };
}

describe("real collection compatibility ABI", () => {
  it("reads sequential RAM packs, borrows raw bytes and inflates owned EXT copies", () => {
    const { ext, bridge, call, str } = wire();
    const image = new TextEncoder().encode("MRPGCMAPabcdefgh0123456789");
    const compressed = gzipStore(image);
    // Same 12-byte header + sequential record layout used by real wrappers.
    const pack = new Uint8Array(24 + compressed.length);
    const view = new DataView(pack.buffer);
    pack.set(new TextEncoder().encode("MRPG"));
    view.setUint32(4, 4, true);
    view.setUint32(8, pack.length, true);
    view.setUint32(12, 4, true);
    pack.set([97, 98, 99, 0], 16);
    view.setUint32(20, compressed.length, true);
    pack.set(compressed, 24);
    const ram = ext.alloc(pack.length), lenp = ext.alloc(4), name = str("abc");
    ext.mem.load(ram, pack);
    ext.mem.write8(ext.mem.read32(tableSlotAddr(100)), 36);
    ext.mem.write32(ext.mem.read32(tableSlotAddr(104)), ram);
    ext.mem.write32(ext.mem.read32(tableSlotAddr(105)), pack.length);
    expect(call(125, name, lenp, 1)).toBe(1);
    expect(call(125, str("missing"), lenp, 0)).toBe(0);
    expect(call(125, name, lenp, 2)).toBe(ram + 24);
    expect(ext.mem.read32(lenp)).toBe(compressed.length);
    const loaded = call(125, name, lenp, 0);
    expect([...ext.mem.slice(loaded, image.length)]).toEqual([...image]);
    expect(ext.mem.read32(lenp)).toBe(image.length);
    expect(bridge.liveAllocs().some(a => a.guestAddr === loaded)).toBe(true);
    // A private loader keeps its own record/P header while staging a blank body.
    const staged = ext.alloc(image.length);
    ext.mem.write32(staged, 0x12345678);
    ext.mem.write32(staged + 4, 0x87654321);
    ext.mem.fill(loaded, 0xff, image.length); // staging must use the immutable read copy
    call(131, 0, 9, staged, image.length);
    expect(ext.mem.read32(staged)).toBe(0x12345678);
    expect(ext.mem.read32(staged + 4)).toBe(0x87654321);
    expect([...ext.mem.slice(staged + 8, image.length - 8)]).toEqual([...image.slice(8)]);
    ext.mem.write32(staged + 8, 0xabcdef);
    call(131, 0, 9, staged, image.length);
    expect(ext.mem.read32(staged + 8)).toBe(0xabcdef); // never overwrite live code
    // A validated extChunk distinguishes a transient nonzero private body
    // from arbitrary cache-sync calls. Preserve its record/P metadata.
    const record=ext.alloc(584), p=ext.alloc(20), chunk=ext.alloc(56);
    ext.mem.write32(staged,record); ext.mem.write32(staged+4,p);
    ext.mem.write32(p+12,chunk);
    for(const [off,value] of [[0,0x7fd854eb],[4,staged+8],[12,staged],[16,image.length],[28,p],[44,record]]) ext.mem.write32(chunk+off,value);
    ext.mem.write32(record+125*4,0xdeadbeef);
    call(131,0,9,staged,image.length);
    expect([...ext.mem.slice(staged+8,image.length-8)]).toEqual([...image.slice(8)]);
    expect(ext.mem.read32(record+125*4)).toBe(tableSlotAddr(125));
    expect(ext.mem.read32(staged+4)).toBe(p);
    ext.mem.write32(chunk+16,image.length+4);
    expect(ext.privateLoaderChunk(staged,image.length)).toBe(0);
    ext.mem.write32(ram, 0);
    expect(call(125, name, lenp, 0)).toBe(0);
  });
  it("returns guest strstr addresses and packs the configured calendar fields", () => {
    const { ext, call, str } = wire();
    const haystack = str("ababc");
    expect(call(16, haystack, str("abc"))).toBe(haystack + 2);
    expect(call(16, haystack, str(""))).toBe(haystack);
    expect(call(16, haystack, str("abcd"))).toBe(0);
    const date = ext.alloc(8);
    expect(call(34, date)).toBe(0);
    expect(ext.mem.read16(date)).toBe(2026);
    expect([...ext.mem.slice(date + 2, 5)]).toEqual([9, 3, 16, 0, 0]);
    expect(call(34, 0)).toBe(-1);
    call(36, 10000);
    expect(call(33)).toBe(10000);
    expect(call(82)).toBe(0);
  });
  it("allocates and releases extended RAM and unwinds guest exit", () => {
    const { ext, bridge } = wire();
    const out = ext.alloc(4), lenp = ext.alloc(4);
    expect(bridge.platEx(ext.mem, new Uint32Array([1014, 0, 64, out, lenp, 0]))).toBe(0);
    const p = ext.mem.read32(out);
    expect(ext.mem.read32(lenp)).toBe(64);
    expect(bridge.liveAllocs().some(a => a.guestAddr === p)).toBe(true);
    expect(bridge.platEx(ext.mem, new Uint32Array([1015, p, 64, 0, 0, 0]))).toBe(0);
    expect(bridge.liveAllocs()).toHaveLength(0);
    const rt = new MythroadRuntime();
    rt.bindExt(ext);
    expect(() => ext.runGuest(tableSlotAddr(54), { lr: EXT_STOP_ADDR })).toThrow("Exiting...");
    expect(rt.exited).toBe(true);
    expect(rt.canRun()).toBe(false);
  });
  it("formats guest hex, unsigned, strings and padding without consuming %% arguments", () => {
    const { ext, str } = wire();
    const fmt = str("%08x %u %s %c %% %05d"), dst = ext.alloc(80);
    const args = [0xfeed, 0xffffffff, str("ok"), 65, -12];
    const expected = "0000feed 4294967295 ok A % -0012";
    const n = guestSprintf(ext.mem, dst, fmt, i => args[i]);
    expect(new TextDecoder().decode(ext.mem.slice(dst, n))).toBe(expected);
    expect(ext.mem.read8(dst + n)).toBe(0);
    expect(guestPrintf(ext.mem, fmt, i => args[i])).toBe(expected);
    expect(guestPrintf(ext.mem, fmt, i => args[i], 5)).toBe("0000f");
  });
  it("publishes screen dimensions through the guest data slots used by clear-screen calls", () => {
    const rt = new MythroadRuntime({ profile: { width: 320, height: 480 } });
    const ext = new ExtRuntime();
    rt.bindExt(ext);
    const readGlobal = (slot: number) => ext.mem.read32(ext.mem.read32(tableSlotAddr(slot)));
    expect([readGlobal(92), readGlobal(93), readGlobal(94)]).toEqual([320, 480, 16]);
    rt.screen.pixels.fill(0xffff);
    const out = ext.runGuest(tableSlotAddr(122), { r0: 0, r1: 0, r2: readGlobal(92), r3: readGlobal(93), lr: EXT_STOP_ADDR });
    expect(out.kind).toBe("return");
    expect(rt.screen.pixels.every(p => p === 0)).toBe(true);
  });
  it.each([0, 1, 55, 56, 63, 64, 65, 129, 1000])("MD5 guest context with split appends, length %i", n => {
    const { ext, call } = wire();
    const context = ext.alloc(88), copy = ext.alloc(88), src = ext.alloc(n + 1), digest = ext.alloc(16);
    const data = Uint8Array.from({ length: n }, (_, i) => (i * 73) & 255);
    ext.mem.load(src, data);
    call(113, context);
    const first = Math.floor(n / 2);
    call(114, context, src, first);
    ext.mem.load(copy, new Uint8Array(ext.mem.slice(context, 88)));
    call(114, copy, src + first, n - first);
    call(115, copy, digest);
    expect(Buffer.from(ext.mem.slice(digest, 16)).toString("hex")).toBe(createHash("md5").update(data).digest("hex"));
    expect(ext.mem.read32(context)).toBe(first * 8);
  });
  it("memmove handles overlap in both directions", () => {
    const { ext, call } = wire();
    const p = ext.alloc(8);
    ext.mem.load(p, [1,2,3,4,5,6]);
    expect(call(4, p + 1, p, 5)).toBe(p + 1);
    expect([...ext.mem.slice(p, 6)]).toEqual([1,1,2,3,4,5]);
    call(4, p, p + 1, 5);
    expect([...ext.mem.slice(p, 5)]).toEqual([1,2,3,4,5]);
    expect(call(4, 0, 0, 0)).toBe(0);
  });
  it("realloc preserves bytes and old ownership on allocation failure", () => {
    const { ext, bridge, call } = wire();
    const p = call(2, 0, 0, 4);
    ext.mem.load(p, [1,2,3,4]);
    expect(call(2, p, 4, 0xffffffff)).toBe(0);
    expect(bridge.liveAllocs()[0].guestAddr).toBe(p);
    const next = call(2, p, 4, 12);
    expect([...ext.mem.slice(next, 4)]).toEqual([1,2,3,4]);
    expect(bridge.liveAllocs().map(a => a.guestAddr)).toEqual([next]);
    expect(call(2, next, 12, 0)).toBe(0);
    expect(bridge.liveAllocs()).toHaveLength(0);
  });
  it("file length/delete distinguish absent, empty, directory, and uploaded pack", () => {
    const { bridge, call, str } = wire();
    const empty = str("save.dat"), pack = str("test.mrp"), dir = str("folder");
    expect(call(46, empty)).toBe(-1);
    expect(call(47, empty)).toBe(-1);
    bridge.appFs.createFile("save.dat", true);
    expect(call(46, empty)).toBe(0);
    expect(call(47, empty)).toBe(0);
    expect(call(46, empty)).toBe(-1);
    bridge.appFs.mkdir("folder");
    expect(call(47, dir)).toBe(-1);
    expect(call(46, pack)).toBe(12);
    expect(call(47, pack)).toBe(-1);
  });
  it("SMS centre query stays asynchronous and cache sync invalidates decoded code", () => {
    const { ext, call } = wire();
    expect(call(37, 1106)).toBe(2);
    const p = ext.alloc(8);
    const region = ext.cache.addRegion(p, 8);
    const generation = region.generation;
    call(131, 0, 9, p, 8);
    expect(region.generation).toBeGreaterThan(generation);
  });
});

describe("Lua startup functions used by real games", () => {
  it("print does not terminate event handlers and keeps a bounded diagnostic log", () => {
    const rt = new MythroadRuntime();
    for (let i = 0; i < 260; i++) invoke(rt.lua, "print", ["frame", i], 0);
    expect(rt.logs).toHaveLength(256);
    expect(rt.logs.at(-1)).toBe("frame\t259");
  });
  it("text width measures GBK and big-endian UCS2", () => {
    const rt = new MythroadRuntime();
    invoke(rt.lua, "_textWidth", ["A\xd6\xd0"], 2);
    expect(resultNum(rt.lua)).toBe(24);
    expect(resultNum(rt.lua, 1)).toBe(16);
    invoke(rt.lua, "_textWidth", ["\x00A\x4e\x2d", 1], 2);
    expect(resultNum(rt.lua)).toBe(24);
  });
  it("dofile keeps the caller stack and returns child results", () => {
    const child = dumpChunk(proto({ maxstack: 2, k: [kn(41)], code: [CREATE_ABx(OP_LOADK, 0, 0), CREATE_ABC(OP_RETURN, 0, 2, 0)] }));
    const parent = dumpChunk(proto({ maxstack: 4, k: [ks("dofile"), ks("child.mr"), kn(1)], code: [
      CREATE_ABx(OP_GETGLOBAL, 0, 0), CREATE_ABx(OP_LOADK, 1, 1), CREATE_ABC(OP_CALL, 0, 2, 2),
      CREATE_ABx(OP_LOADK, 1, 2), CREATE_ABC(OP_ADD, 0, 0, 1), CREATE_ABC(OP_RETURN, 0, 2, 0),
    ] }));
    const rt = new MythroadRuntime();
    rt.loadMrp(buildMrp([{ name: "start.mr", data: parent }, { name: "child.mr", data: child }]));
    rt.start();
    expect(resultNum(rt.lua)).toBe(42);
    expect(rt.lua.L.ci).toHaveLength(1);
  });
});
