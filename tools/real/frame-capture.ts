import type { GraphicsBackend, ScreenBuffer } from "../../src/mythroad/graphics.ts";

/** The LCD retains the last presented frame while a game prepares its next one.
 * Reading the working screen buffer between callbacks can capture an unfinished
 * background instead of the dialogue or sprites the player actually sees.
 */
export class FrameCapture implements GraphicsBackend {
  pixels: Uint16Array;
  frames = 0;
  constructor(private readonly getScreen: () => ScreenBuffer, width: number, height: number) {
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
  flush() {
    this.pixels = this.getScreen().pixels.slice();
    this.frames++;
  }
}
