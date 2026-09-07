import { expect, it } from "vitest";
import { ExtRuntime } from "../../src/abi/runtime.ts";
import { MediaDevices } from "../../src/mythroad/media.ts";

it("copies channel data, rejects malformed and stale handles, and routes device formats", () => {
  const ext = new ExtRuntime(), played: unknown[] = [], stopped: number[] = [];
  const media = new MediaDevices({ alloc: n => ext.alloc(n), readFile: () => null,
    play: (type, bytes, loop) => played.push([type, [...bytes], loop]), stop: type => stopped.push(type) });
  const p = ext.alloc(32), data = ext.alloc(3); ext.mem.load(data, [1,2,3]);
  [data, 3, 1].forEach((v, i) => ext.mem.write32(p + i * 4, v));
  expect(media.dispatch(ext.mem, 2222, p, 8, 0, 0)).toBe(-1);
  const handle = media.dispatch(ext.mem, 2222, p, 12, 0, 0)!; expect(handle).toBeGreaterThan(0);
  ext.mem.write8(data, 99); ext.mem.write32(p, handle);
  expect(media.dispatch(ext.mem, 2231, p, 4, 0, 0)).toBe(-1);
  expect(media.dispatch(ext.mem, 2232, p, 4, 0, 0)).toBe(0);
  expect(played).toEqual([[1, [1,2,3], 1]]);
  expect(media.dispatch(ext.mem, 2252, p, 4, 0, 0)).toBe(0);
  expect(stopped).toEqual([1]);
  expect(media.dispatch(ext.mem, 2232, p, 4, 0, 0)).toBe(-1);
});

it("initializes, loads, plays and closes a media device with a guest-visible status pointer", () => {
  const ext = new ExtRuntime(), played: unknown[] = [];
  const media = new MediaDevices({ alloc: n => ext.alloc(n), readFile: () => null,
    play: (type, bytes, loop) => played.push([type, [...bytes], loop]), stop: () => {} });
  const p = ext.alloc(32), out = p+16, len = p+20; ext.mem.load(p, [7,8,9]);
  const call = (code: number, input=0, size=0) => media.dispatch(ext.mem,code,input,size,out,len);
  expect(call(2011)).toBe(0); expect(call(2091)).toBe(2);
  expect(ext.mem.read32(ext.mem.read32(out))).toBe(2); expect(ext.mem.read32(len)).toBe(4);
  expect(call(2041)).toBe(-1); expect(call(2031,p,3)).toBe(0); expect(call(2041)).toBe(0);
  expect(call(2091)).toBe(4); expect(played).toEqual([[0,[7,8,9],0]]);
  expect(call(2081)).toBe(0); expect(call(2091)).toBe(1);
});
