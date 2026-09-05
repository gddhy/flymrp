import { describe, expect, it } from "vitest";
import {
  Canvas2DBackend,
  makeRgb565,
  rgb565ToRgba,
  ScreenBuffer,
  type CanvasImageDataLike,
} from "../../src/mythroad/index.ts";

function fakeCtx() {
  const puts: CanvasImageDataLike[] = [];
  return {
    puts,
    createImageData(width: number, height: number): CanvasImageDataLike {
      return { width, height, data: new Uint8ClampedArray(width * height * 4) };
    },
    putImageData(image: CanvasImageDataLike, dx: number, dy: number): void {
      expect(dx).toBe(0);
      expect(dy).toBe(0);
      puts.push(image);
    },
  };
}

describe("Canvas2D RGB565 present", () => {
  it("expands RGB565 channels to RGBA", () => {
    const src = new Uint16Array([0xf800, 0x07e0, 0x001f, 0x0000]);
    const dst = new Uint8ClampedArray(16);
    rgb565ToRgba(src, dst);
    expect([...dst.slice(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...dst.slice(4, 8)]).toEqual([0, 255, 0, 255]);
    expect([...dst.slice(8, 12)]).toEqual([0, 0, 255, 255]);
    expect([...dst.slice(12, 16)]).toEqual([0, 0, 0, 255]);
  });

  it("flush presents the host ScreenBuffer, not a guest pointer", () => {
    const screen = new ScreenBuffer(2, 1);
    screen.pixels[0] = makeRgb565(255, 0, 0);
    screen.pixels[1] = makeRgb565(0, 0, 255);
    const ctx = fakeCtx();
    const gfx = new Canvas2DBackend(ctx, () => screen);
    gfx.flush(0, 0, 2, 1, 0);
    expect(gfx.frames).toBe(1);
    expect(ctx.puts).toHaveLength(1);
    expect(ctx.puts[0]!.width).toBe(2);
    expect(ctx.puts[0]!.height).toBe(1);
    expect([...ctx.puts[0]!.data.slice(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...ctx.puts[0]!.data.slice(4, 8)]).toEqual([0, 0, 255, 255]);
  });
});
