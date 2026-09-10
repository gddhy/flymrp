import { copyLcdDirtyRect, type GraphicsBackend, type ScreenBuffer } from "../../src/mythroad/graphics.ts";

/** The LCD retains the last presented rectangle. Games often prepare the next
 * map in the working buffer, then `mr_drawBitmap` only the playfield. Reading
 * the working screen between flushes — or copying the whole cache on a dirty
 * present — captures overwritten HUD chrome instead of what the player sees.
 */
export class FrameCapture implements GraphicsBackend {
  pixels: Uint16Array;
  frames = 0;
  width: number;
  height: number;
  constructor(private readonly getScreen: () => ScreenBuffer, width: number, height: number) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint16Array(width * height);
  }
  clear() {}
  drawRect() {}
  drawLine() {}
  drawPoint() {}
  drawText() {}
  effSetCon() {}
  image() {}
  sprite() {}
  tile() {}
  flush(x = 0, y = 0, w?: number, h?: number, _index?: number) {
    const screen = this.getScreen();
    if (screen.width !== this.width || screen.height !== this.height) {
      this.width = screen.width;
      this.height = screen.height;
      this.pixels = new Uint16Array(this.width * this.height);
    }
    copyLcdDirtyRect(
      this.pixels,
      this.width,
      this.height,
      screen.pixels,
      screen.width,
      screen.height,
      x,
      y,
      w ?? this.width,
      h ?? this.height,
    );
    this.frames++;
  }
}
