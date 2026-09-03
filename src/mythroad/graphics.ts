export type DrawCommand =
  | { op: "clear"; r: number; g: number; b: number }
  | { op: "rect"; x: number; y: number; w: number; h: number; r: number; g: number; b: number }
  | { op: "line"; x1: number; y1: number; x2: number; y2: number; r: number; g: number; b: number }
  | { op: "point"; x: number; y: number; r: number; g: number; b: number }
  | { op: "text"; text: string; x: number; y: number; r: number; g: number; b: number; unicode: number; font: number }
  | { op: "eff"; x: number; y: number; w: number; h: number; perr: number; perg: number; perb: number }
  | { op: "flush"; x: number; y: number; w: number; h: number; index: number };

export interface GraphicsBackend {
  clear(r: number, g: number, b: number): void;
  drawRect(x: number, y: number, w: number, h: number, r: number, g: number, b: number): void;
  drawLine(x1: number, y1: number, x2: number, y2: number, r: number, g: number, b: number): void;
  drawPoint(x: number, y: number, r: number, g: number, b: number): void;
  drawText(text: string, x: number, y: number, r: number, g: number, b: number, unicode: number, font: number): void;
  effSetCon(x: number, y: number, w: number, h: number, perr: number, perg: number, perb: number): void;
  flush(x: number, y: number, w: number, h: number, index: number): void;
}

/** Test-only. No Canvas. Replaced later without touching Lua/CPU hot path. */
export class NullGraphicsBackend implements GraphicsBackend {
  commands: DrawCommand[] = [];

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
}
