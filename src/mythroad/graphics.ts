/** rxgj `MAKERGB` / `MAKERGB565`: R5 G6 B5. */
export function makeRgb565(r: number, g: number, b: number): number {
  return ((((r >>> 3) & 0x1f) << 11) | (((g >>> 2) & 0x3f) << 5) | ((b >>> 3) & 0x1f)) & 0xffff;
}

export function asI16(v: number): number {
  return (v << 16) >> 16;
}

/** C `mr_helper.h` `_DrawBitmap` rop enum. Not the Lua `BM_COPY=0` test alias. */
export const DRAW_BM_OR = 0;
export const DRAW_BM_XOR = 1;
export const DRAW_BM_COPY = 2;
export const DRAW_BM_NOT = 3;
export const DRAW_BM_MERGENOT = 4;
export const DRAW_BM_ANDNOT = 5;
export const DRAW_BM_TRANSPARENT = 6;
export const DRAW_BM_AND = 7;
export const DRAW_BM_GRAY = 8;
export const DRAW_BM_REVERSE = 9;
export const MR_SPRITE_INDEX_MASK = 0x03ff;
export const MR_SPRITE_TRANSPARENT = 0x0400;
export const MR_TILE_SHIFT = 11;
export const MR_ROTATE_0 = 0;
export const MR_ROTATE_90 = 1;
export const MR_ROTATE_180 = 2;
export const MR_ROTATE_270 = 3;

/**
 * Mythroad `mr_screenBuf` RGB565 cache.
 * Host-owned screen memory, not a guest heap pointer.
 */
export class ScreenBuffer {
  pixels: Uint16Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.pixels = new Uint16Array(width * height);
  }

  /**
   * rxgj `DrawRect`: clip to screen, fill RGB565.
   * Zero-size or fully off-screen is a no-op (`MR_SUCCESS`).
   */
  drawRect(x: number, y: number, w: number, h: number, r: number, g: number, b: number): void {
    const x0 = asI16(x);
    const y0 = asI16(y);
    const w0 = asI16(w);
    const h0 = asI16(h);
    const minX = Math.max(0, x0);
    const minY = Math.max(0, y0);
    const maxX = Math.min(this.width, x0 + w0);
    const maxY = Math.min(this.height, y0 + h0);
    if (maxY <= minY || maxX <= minX) return;
    const color = makeRgb565(r & 0xff, g & 0xff, b & 0xff);
    for (let yy = minY; yy < maxY; yy++) {
      const row = yy * this.width;
      for (let xx = minX; xx < maxX; xx++) this.pixels[row + xx] = color;
    }
  }

  /**
   * Blit a sky16-style glyph: 16 rows × 2 bytes, MSB-first.
   * Not pixel-identical to device `gb16.uc2`.
   */
  drawGlyph(x: number, y: number, width: number, height: number, bits: Uint8Array, r: number, g: number, b: number): void {
    const color = makeRgb565(r & 0xff, g & 0xff, b & 0xff);
    const x0 = asI16(x);
    const y0 = asI16(y);
    const w = width | 0;
    const h = height | 0;
    for (let gy = 0; gy < h; gy++) {
      const py = y0 + gy;
      if (py < 0 || py >= this.height) continue;
      const hi = bits[gy * 2] ?? 0;
      const lo = bits[gy * 2 + 1] ?? 0;
      const row = ((hi << 8) | lo) & 0xffff;
      const dest = py * this.width;
      for (let gx = 0; gx < w; gx++) {
        if ((row & (0x8000 >> gx)) === 0) continue;
        const px = x0 + gx;
        if (px < 0 || px >= this.width) continue;
        this.pixels[dest + px] = color;
      }
    }
  }

  /**
   * rxgj `_DrawBitmap` into this RGB565 cache.
   * `readPixel(i)` is guest pixel `p[i]` (uint16 index, not a host pointer).
   */
  drawBitmapRop(
    readPixel: (i: number) => number,
    x: number,
    y: number,
    w: number,
    h: number,
    rop: number,
    trans: number,
    sx: number,
    sy: number,
    mw: number,
  ): void {
    const maxX = Math.min(this.width, x + w);
    const maxY = Math.min(this.height, y + h);
    const minX = Math.max(0, x);
    const minY = Math.max(0, y);
    if (maxY <= minY || maxX <= minX) return;
    const t = trans & 0xffff;
    const blitW = w | 0;
    if ((rop & 0xffff) > MR_SPRITE_TRANSPARENT) {
      const bitmapRop = rop & MR_SPRITE_INDEX_MASK;
      const mode = (rop >>> MR_TILE_SHIFT) & 0x3;
      const flip = (rop >>> MR_TILE_SHIFT) & 0x4;
      if (bitmapRop === DRAW_BM_TRANSPARENT) {
        for (let dy = minY; dy < maxY; dy++) {
          const dest = dy * this.width;
          for (let dx = minX; dx < maxX; dx++) {
            const src = readPixel((dy - y) * blitW + (dx - x)) & 0xffff;
            if (src !== t) this.pixels[dest + dx] = src;
          }
        }
        return;
      }
      if (bitmapRop !== DRAW_BM_COPY) return;
      for (let dy = minY; dy < maxY; dy++) {
        const dest = dy * this.width;
        for (let dx = minX; dx < maxX; dx++) {
          const relX = dx - x;
          const relY = dy - y;
          let srcI = 0;
          switch (mode) {
            case MR_ROTATE_0:
              srcI = (flip ? h - 1 - relY : relY) * blitW + relX;
              break;
            case MR_ROTATE_90:
              srcI = (flip ? h - 1 - relX : relX) * blitW + (w - 1 - relY);
              break;
            case MR_ROTATE_180:
              srcI = (flip ? relY : h - 1 - relY) * blitW + (w - 1 - relX);
              break;
            case MR_ROTATE_270:
              srcI = (flip ? relX : h - 1 - relX) * blitW + relY;
              break;
            default:
              continue;
          }
          this.pixels[dest + dx] = readPixel(srcI) & 0xffff;
        }
      }
      return;
    }
    const srcAt = (dx: number, dy: number) => readPixel((dy - y + sy) * mw + (dx - x + sx)) & 0xffff;
    switch (rop & 0xffff) {
      case DRAW_BM_TRANSPARENT:
        for (let dy = minY; dy < maxY; dy++) {
          const dest = dy * this.width;
          for (let dx = minX; dx < maxX; dx++) {
            const src = srcAt(dx, dy);
            if (src !== t) this.pixels[dest + dx] = src;
          }
        }
        break;
      case DRAW_BM_COPY:
        for (let dy = minY; dy < maxY; dy++) {
          const dest = dy * this.width;
          for (let dx = minX; dx < maxX; dx++) this.pixels[dest + dx] = srcAt(dx, dy);
        }
        break;
      case DRAW_BM_GRAY:
      case DRAW_BM_OR:
      case DRAW_BM_XOR:
      case DRAW_BM_NOT:
      case DRAW_BM_MERGENOT:
      case DRAW_BM_ANDNOT:
      case DRAW_BM_AND:
      case DRAW_BM_REVERSE:
        for (let dy = minY; dy < maxY; dy++) {
          const dest = dy * this.width;
          for (let dx = minX; dx < maxX; dx++) {
            const src = srcAt(dx, dy);
            const dst = this.pixels[dest + dx]! & 0xffff;
            switch (rop & 0xffff) {
              case DRAW_BM_GRAY:
                if (src !== t) {
                  const r5 = (src & 0xf800) >>> 11;
                  const g5 = (src & 0x7e0) >>> 6;
                  const b5 = src & 0x1f;
                  const gray = ((r5 * 60 + g5 * 118 + b5 * 22) / 25) | 0;
                  this.pixels[dest + dx] = makeRgb565(gray, gray, gray);
                }
                break;
              case DRAW_BM_REVERSE:
                if (src !== t) this.pixels[dest + dx] = (~src) & 0xffff;
                break;
              case DRAW_BM_OR:
                this.pixels[dest + dx] = (src | dst) & 0xffff;
                break;
              case DRAW_BM_XOR:
                this.pixels[dest + dx] = (src ^ dst) & 0xffff;
                break;
              case DRAW_BM_NOT:
                this.pixels[dest + dx] = (~src) & 0xffff;
                break;
              case DRAW_BM_MERGENOT:
                this.pixels[dest + dx] = ((~src) | dst) & 0xffff;
                break;
              case DRAW_BM_ANDNOT:
                this.pixels[dest + dx] = ((~src) & dst) & 0xffff;
                break;
              case DRAW_BM_AND:
                this.pixels[dest + dx] = (src & dst) & 0xffff;
                break;
            }
          }
        }
        break;
    }
  }
}

export type DrawCommand =
  | { op: "clear"; r: number; g: number; b: number }
  | { op: "rect"; x: number; y: number; w: number; h: number; r: number; g: number; b: number }
  | { op: "line"; x1: number; y1: number; x2: number; y2: number; r: number; g: number; b: number }
  | { op: "point"; x: number; y: number; r: number; g: number; b: number }
  | { op: "pixel"; x: number; y: number; r: number; g: number; b: number }
  | { op: "text"; text: string; x: number; y: number; r: number; g: number; b: number; unicode: number; font: number }
  | { op: "eff"; x: number; y: number; w: number; h: number; perr: number; perg: number; perb: number }
  | { op: "flush"; x: number; y: number; w: number; h: number; index: number }
  | {
      op: "image";
      sub?: "load" | "show" | "draw" | "new";
      i: number;
      filename?: string;
      x?: number;
      y?: number;
      w?: number;
      h?: number;
      maxw?: number;
      rop?: number;
      sx?: number;
      sy?: number;
      di?: number;
      si?: number;
    }
  | { op: "sprite"; i: number; spriteindex: number; x: number; y: number; mod: number }
  | {
      op: "tile";
      sub?: "set" | "rect" | "draw";
      i: number;
      x?: number;
      y?: number;
      w?: number;
      h?: number;
      tileh?: number;
      x1?: number;
      y1?: number;
      x2?: number;
      y2?: number;
    };

export type BitmapSlot = { w: number; h: number; loaded: boolean; name: string };
export type SpriteSlot = { h: number };
export type TileSlot = { x: number; y: number; w: number; h: number; tileh: number; x1: number; y1: number; x2: number; y2: number };

export interface GraphicsBackend {
  clear(r: number, g: number, b: number): void;
  drawRect(x: number, y: number, w: number, h: number, r: number, g: number, b: number): void;
  drawLine(x1: number, y1: number, x2: number, y2: number, r: number, g: number, b: number): void;
  drawPoint(x: number, y: number, r: number, g: number, b: number): void;
  drawText(text: string, x: number, y: number, r: number, g: number, b: number, unicode: number, font: number): void;
  effSetCon(x: number, y: number, w: number, h: number, perr: number, perg: number, perb: number): void;
  flush(x: number, y: number, w: number, h: number, index: number): void;
  image(cmd: Extract<DrawCommand, { op: "image" }>): void;
  sprite(cmd: Extract<DrawCommand, { op: "sprite" }>): void;
  tile(cmd: Extract<DrawCommand, { op: "tile" }>): void;
}

/** Test-only. No Canvas. Replaced later without touching Lua/CPU hot path. */
export class NullGraphicsBackend implements GraphicsBackend {
  commands: DrawCommand[] = [];
  bitmaps: BitmapSlot[] = [];
  sprites: SpriteSlot[] = [];
  tiles: TileSlot[] = [];

  clear(r: number, g: number, b: number): void {
    this.commands.push({ op: "clear", r, g, b });
  }
  drawRect(x: number, y: number, w: number, h: number, r: number, g: number, b: number): void {
    this.commands.push({ op: "rect", x, y, w, h, r, g, b });
  }
  drawLine(x1: number, y1: number, x2: number, y2: number, r: number, g: number, b: number): void {
    this.commands.push({ op: "line", x1, y1, x2, y2, r, g, b });
  }
  drawPoint(x: number, y: number, r: number, g: number, b: number): void {
    this.commands.push({ op: "point", x, y, r, g, b });
  }
  drawText(text: string, x: number, y: number, r: number, g: number, b: number, unicode: number, font: number): void {
    this.commands.push({ op: "text", text, x, y, r, g, b, unicode, font });
  }
  effSetCon(x: number, y: number, w: number, h: number, perr: number, perg: number, perb: number): void {
    this.commands.push({ op: "eff", x, y, w, h, perr, perg, perb });
  }
  flush(x: number, y: number, w: number, h: number, index: number): void {
    this.commands.push({ op: "flush", x, y, w, h, index });
  }
  image(cmd: Extract<DrawCommand, { op: "image" }>): void {
    this.commands.push(cmd);
    if (cmd.sub === "load" || cmd.sub === "new") {
      this.bitmaps[cmd.i] = { w: cmd.w ?? 0, h: cmd.h ?? 0, loaded: true, name: cmd.filename ?? "" };
    }
  }
  sprite(cmd: Extract<DrawCommand, { op: "sprite" }>): void {
    this.commands.push(cmd);
  }
  tile(cmd: Extract<DrawCommand, { op: "tile" }>): void {
    this.commands.push(cmd);
    if (cmd.sub === "set") {
      this.tiles[cmd.i] = {
        x: cmd.x ?? 0,
        y: cmd.y ?? 0,
        w: cmd.w ?? 0,
        h: cmd.h ?? 0,
        tileh: cmd.tileh ?? 0,
        x1: 0,
        y1: 0,
        x2: 0,
        y2: 0,
      };
    }
    if (cmd.sub === "rect" && this.tiles[cmd.i]) {
      const t = this.tiles[cmd.i]!;
      t.x1 = cmd.x1 ?? 0;
      t.y1 = cmd.y1 ?? 0;
      t.x2 = cmd.x2 ?? 0;
      t.y2 = cmd.y2 ?? 0;
    }
  }
}

/** 5-bit / 6-bit channel → 8-bit. Not claimed pixel-identical to a device LCD. */
export function rgb565ToRgba(src: Uint16Array, dst: Uint8ClampedArray): void {
  if (dst.length < src.length * 4) throw new RangeError("rgba buffer too small");
  for (let i = 0; i < src.length; i++) {
    const p = src[i]! & 0xffff;
    const r5 = (p >>> 11) & 0x1f;
    const g6 = (p >>> 5) & 0x3f;
    const b5 = p & 0x1f;
    const o = i << 2;
    dst[o] = (r5 << 3) | (r5 >>> 2);
    dst[o + 1] = (g6 << 2) | (g6 >>> 4);
    dst[o + 2] = (b5 << 3) | (b5 >>> 2);
    dst[o + 3] = 255;
  }
}

export type CanvasImageDataLike = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

/** Minimal Canvas2D surface. No DOM types. */
export type Canvas2DContextLike = {
  createImageData(width: number, height: number): CanvasImageDataLike;
  putImageData(image: CanvasImageDataLike, dx: number, dy: number): void;
};

/**
 * Guest RGB565 ScreenBuffer → host RGBA ImageData → putImageData.
 * Drawing stays on the guest-visible cache; this only presents.
 */
export class Canvas2DBackend implements GraphicsBackend {
  frames = 0;
  lastImage: CanvasImageDataLike | null = null;

  constructor(
    private readonly ctx: Canvas2DContextLike,
    private readonly getScreen: () => ScreenBuffer,
  ) {}

  clear(_r: number, _g: number, _b: number): void {}
  drawRect(_x: number, _y: number, _w: number, _h: number, _r: number, _g: number, _b: number): void {}
  drawLine(_x1: number, _y1: number, _x2: number, _y2: number, _r: number, _g: number, _b: number): void {}
  drawPoint(_x: number, _y: number, _r: number, _g: number, _b: number): void {}
  drawText(
    _text: string,
    _x: number,
    _y: number,
    _r: number,
    _g: number,
    _b: number,
    _unicode: number,
    _font: number,
  ): void {}
  effSetCon(_x: number, _y: number, _w: number, _h: number, _perr: number, _perg: number, _perb: number): void {}
  image(_cmd: Extract<DrawCommand, { op: "image" }>): void {}
  sprite(_cmd: Extract<DrawCommand, { op: "sprite" }>): void {}
  tile(_cmd: Extract<DrawCommand, { op: "tile" }>): void {}

  flush(_x: number, _y: number, _w: number, _h: number, _index: number): void {
    const screen = this.getScreen();
    const img = this.ctx.createImageData(screen.width, screen.height);
    rgb565ToRgba(screen.pixels, img.data);
    this.ctx.putImageData(img, 0, 0);
    this.lastImage = img;
    this.frames++;
  }
}
