import { describe, expect, it } from "vitest";
import { clockSlices, rotatedDirection, screenPoint } from "../../web/player-options.ts";
describe("player rotation and speed", () => {
  it("maps all four rotated display corners back to guest coordinates", () => {
    expect(screenPoint(0, 0, 240, 320, 0)).toEqual([0, 0]);
    expect(screenPoint(0, 0, 240, 320, 1)).toEqual([0, 319]);
    expect(screenPoint(0, 0, 240, 320, 2)).toEqual([239, 319]);
    expect(screenPoint(0, 0, 240, 320, 3)).toEqual([239, 0]);
    expect(screenPoint(.25, .75, 240, 320, 1)).toEqual([180, 240]);
    expect(screenPoint(-1, 2, 240, 320, 3)).toEqual([0, 0]);
  });
  it("keeps physical directions aligned with the rotated image without rotating number keys", () => {
    expect(rotatedDirection("UP", 1)).toBe("LEFT");
    expect(rotatedDirection("RIGHT", 3)).toBe("DOWN");
    expect(rotatedDirection("UP", 2)).toBe("DOWN");
    expect(rotatedDirection("5", 1)).toBe("5");
  });
  it("scales guest time in bounded steps and avoids catching up an entire hidden-tab interval", () => {
    expect(clockSlices(16, 4)).toEqual([20, 20, 20, 4]);
    expect(clockSlices(16, .5)).toEqual([8]);
    expect(clockSlices(5000, 4).reduce((a, b) => a + b, 0)).toBe(400);
    expect(clockSlices(-1, 2)).toEqual([]);
  });
});
