import { describe, expect, it } from "vitest";
import { ScreenBuffer } from "../../src/mythroad/graphics.ts";
import { FrameCapture } from "../../tools/real/frame-capture.ts";

describe("collection LCD capture", () => {
  it("retains the displayed scene while the guest clears its next frame", () => {
    const screen = new ScreenBuffer(2, 2);
    const display = new FrameCapture(() => screen, 2, 2);
    screen.pixels.set([1, 2, 3, 4]);
    expect([...display.pixels]).toEqual([0, 0, 0, 0]);
    display.flush();
    screen.pixels.fill(9);
    expect([...display.pixels]).toEqual([1, 2, 3, 4]);
    display.flush();
    expect([...display.pixels]).toEqual([9, 9, 9, 9]);
    expect(display.frames).toBe(2);
  });
});
