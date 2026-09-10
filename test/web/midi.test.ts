import { describe, expect, it } from "vitest";
import { parseMidi } from "../../web/midi.ts";
const u32 = (n: number) => [n >>> 24, n >>> 16 & 255, n >>> 8 & 255, n & 255];
function smf(tracks: number[][], division = 96) {
  return new Uint8Array([77,84,104,100,0,0,0,6,0,tracks.length > 1 ? 1 : 0,0,tracks.length,division >>> 8, division & 255,
    ...tracks.flatMap(track => [77,84,114,107,...u32(track.length),...track])]);
}
describe("SMF scheduling", () => {
  it("merges format 1 tempo tracks and preserves controllers, programs, drums and final rest", () => {
    const song = parseMidi(smf([
      [0,255,81,3,7,161,32,96,255,81,3,15,66,64,96,255,47,0],
      [0,192,40,0,176,7,100,0,153,36,100,96,36,0,96,144,60,80,96,128,60,0,96,255,47,0],
    ]));
    expect(song.events.map(e => e.time)).toEqual([0,0,0,.5,1.5,2.5]);
    expect(song.events[0].message).toEqual([192,40]);
    expect(song.events[3].message).toEqual([153,36,0]);
    expect(song.duration).toBe(3.5);
  });
  it("uses SMPTE time rather than applying tempo to frame ticks", () => {
    const song = parseMidi(smf([[0,144,60,80,100,128,60,0,0,255,47,0]], 0xe728));
    expect(song.duration).toBeCloseTo(.1);
  });
  it("bounds malformed tracks, running status and VLQs instead of hanging", () => {
    for (const track of [[0,60,80], [0,255,81,3,7], [128,128,128,128,0], [0,144,60]])
      expect(() => parseMidi(smf([track]))).toThrow();
    expect(() => parseMidi(smf([[0,255,47,0]]).subarray(0,24))).toThrow();
  });
  it("accepts a bounded track without an end marker", () => {
    expect(parseMidi(smf([[0,144,60,80,96,128,60,0]])).duration).toBe(.5);
  });
});
