import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const synth = vi.hoisted(() => ({ reset: vi.fn(), stopMIDI: vi.fn(), setMasterVol: vi.fn(), send: vi.fn(), getAudioContext: vi.fn() }));
vi.mock("webaudio-tinysynth", () => ({ default: class { constructor() { return synth; } } }));
import { BrowserAudio } from "../../web/audio.ts";
import { MR_SOUND_MIDI, MR_SOUND_MP3 } from "../../src/mythroad/index.ts";
const midi = new Uint8Array([77,84,104,100,0,0,0,6,0,0,0,1,0,96,77,84,114,107,0,0,0,12,0,144,60,80,96,128,60,0,0,255,47,0]);
describe("browser audio lifecycle", () => {
  let pending: ((value: AudioBuffer) => void)[], starts: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers(); pending = []; starts = vi.fn();
    const context = { state: "running", currentTime: 0, destination: {},
      decodeAudioData: () => new Promise<AudioBuffer>(resolve => pending.push(resolve)),
      createBufferSource: () => ({ connect: vi.fn(), disconnect: vi.fn(), start: starts, stop: vi.fn() }) };
    synth.getAudioContext.mockReturnValue(context);
    vi.stubGlobal("window", { AudioContext: class { constructor() { return context; } }, setInterval, clearInterval, setTimeout, clearTimeout });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
  it("does not resurrect sound when a stopped decode finishes", async () => {
    const audio = new BrowserAudio(); audio.play(MR_SOUND_MP3, new Uint8Array([1]), 0); audio.stopAll();
    pending[0]({} as AudioBuffer); await Promise.resolve(); expect(starts).not.toHaveBeenCalled();
  });
  it("only plays the newest decode of the same sound type", async () => {
    const audio = new BrowserAudio(); audio.play(MR_SOUND_MP3, new Uint8Array([1]), 0); audio.play(MR_SOUND_MP3, new Uint8Array([2]), 0);
    pending[1]({} as AudioBuffer); await Promise.resolve(); pending[0]({} as AudioBuffer); await Promise.resolve();
    expect(starts).toHaveBeenCalledTimes(1); audio.stopAll();
  });
  it("defaults to GM, schedules a note and cancels MIDI timers on stop", () => {
    const audio = new BrowserAudio(); expect(audio.midiPlayer).toBe("tinysynth"); audio.play(MR_SOUND_MIDI, midi, 1);
    expect(synth.send).toHaveBeenCalledWith([144,60,80], .05); audio.stopAll();
    expect(synth.stopMIDI).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
    audio.setMidiPlayer("simple"); expect(vi.getTimerCount()).toBe(0);
  });
});
