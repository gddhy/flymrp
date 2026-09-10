import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AEX_P_ER_RW_OFF } from "../../src/abi/layout.ts";
import {
  Canvas2DBackend,
  MR_TIMER_STATE_RUNNING,
  MythroadRuntime,
  type CanvasImageDataLike,
} from "../../src/mythroad/index.ts";

const REAL_APP = resolve(import.meta.dirname, "../fixtures/real/app.mrp");

/** LIVE this fixture: PRESS+FIRE is remapped to ER_RW+180 = 0x0109. Not a universal key map. */
const GSSJXZ_FIRE_PRESS_RW = 0x0109;

function checksum(pixels: Uint16Array): number {
  let s = 0;
  for (const p of pixels) s = (s + p) >>> 0;
  return s;
}

function fakeCtx() {
  const puts: CanvasImageDataLike[] = [];
  return {
    puts,
    createImageData(width: number, height: number): CanvasImageDataLike {
      return { width, height, data: new Uint8ClampedArray(width * height * 4) };
    },
    putImageData(image: CanvasImageDataLike): void {
      puts.push(image);
    },
  };
}

function boot() {
  const ctx = fakeCtx();
  let rt: MythroadRuntime;
  const gfx = new Canvas2DBackend(ctx, () => rt.screen);
  rt = new MythroadRuntime({ graphics: gfx, abiMode: "strict" });
  rt.loadMrp(new Uint8Array(readFileSync(REAL_APP)));
  rt.start("start.mr");
  return { rt, gfx, ctx };
}

function rwKey(rt: MythroadRuntime): number {
  const ext = rt.ext;
  if (!ext) throw new Error("missing EXT");
  const rw = ext.mem.read32((ext.owners.wrapper.p + AEX_P_ER_RW_OFF) >>> 0) >>> 0;
  return ext.mem.read32((rw + 180) >>> 0) >>> 0;
}

describe("5-D real MRP runtime loop", () => {
  it("timer frames present to Canvas; FIRE reaches EXT RW", () => {
    expect(existsSync(REAL_APP)).toBe(true);
    const { rt, gfx, ctx } = boot();
    expect(rt.unknownRequiredSlot).toBeNull();
    expect(rt.timers.state).toBe(MR_TIMER_STATE_RUNNING);
    expect(rt.timers.interval).toBe(80);

    const frames0 = gfx.frames;
    const sums: number[] = [];
    for (let i = 0; i < 3; i++) {
      rt.advance(80);
      expect(rt.step()).toBe(true);
      expect(rt.unknownRequiredSlot).toBeNull();
      expect(rt.timers.state).toBe(MR_TIMER_STATE_RUNNING);
      expect(rt.timers.interval).toBe(80);
      sums.push(checksum(rt.screen.pixels));
    }
    expect(gfx.frames).toBeGreaterThan(frames0);
    expect(ctx.puts.length).toBe(gfx.frames);
    expect(ctx.puts.at(-1)!.width).toBe(240);
    expect(ctx.puts.at(-1)!.height).toBe(320);
    expect(ctx.puts.at(-1)!.data.some((b) => b !== 0)).toBe(true);
    expect(new Set(sums).size).toBeGreaterThanOrEqual(1);

    expect(rwKey(rt)).toBe(0);
    rt.input.press("FIRE");
    expect(rt.step()).toBe(true);
    expect(rwKey(rt)).toBe(GSSJXZ_FIRE_PRESS_RW);
  });

  it("SOFTRIGHT on 开启声音？ changes framebuffer after next timer", () => {
    const { rt } = boot();
    for (let i = 0; i < 48; i++) {
      rt.advance(80);
      expect(rt.step()).toBe(true);
    }
    const before = checksum(rt.screen.pixels);
    rt.input.press("SOFTRIGHT");
    expect(rt.step()).toBe(true);
    expect(rt.unknownRequiredSlot).toBeNull();
    expect(rt.mrTable?.lastStopSound).toEqual({ type: 0 });
    rt.advance(80);
    expect(rt.step()).toBe(true);
    expect(rt.unknownRequiredSlot).toBeNull();
    expect(checksum(rt.screen.pixels)).not.toBe(before);
    expect(rt.timers.state).toBe(MR_TIMER_STATE_RUNNING);
    expect(rt.timers.interval).toBe(80);
  });

  it("two clean starts match screen checksum and timer interval", () => {
    const a = boot();
    const b = boot();
    expect(checksum(a.rt.screen.pixels)).toBe(checksum(b.rt.screen.pixels));
    expect(a.rt.timers.interval).toBe(80);
    expect(b.rt.timers.interval).toBe(80);
    expect(a.rt.unknownRequiredSlot).toBeNull();
    expect(b.rt.unknownRequiredSlot).toBeNull();
  });
});
