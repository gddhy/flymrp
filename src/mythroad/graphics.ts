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
