/** rxgj `MAKERGB` / `MAKERGB565`: R5 G6 B5. */
export function makeRgb565(r: number, g: number, b: number): number {
  return ((((r >>> 3) & 0x1f) << 11) | (((g >>> 2) & 0x3f) << 5) | ((b >>> 3) & 0x1f)) & 0xffff;
}

export function asI16(v: number): number {
  return (v << 16) >> 16;
}

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
