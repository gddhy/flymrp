import { MythroadRuntime } from "../mythroad/index.ts";

/**
 * LIVE fingerprints for `test/fixtures/real/app.mrp` (蜀山剑侠传 / gssjxz).
 * Not a universal Mythroad scene detector. Tests wait on these values instead
 * of treating a raw frame count as the only success condition.
 */
export const GSSJXZ_FP = {
  soundDialog: 798243022,
  title: 2567031015,
  intro: 2367559949,
  gameplay: 2054893696,
} as const;

export type PlayableExtCall = {
  code: number;
  kind: string;
  r0: number;
  insn: number;
};

export type PlayablePathResult = {
  ok: boolean;
  soundDialog: boolean;
  titleScreen: boolean;
  startGame: boolean;
  gameplayFrame: boolean;
  gameplayInput: boolean;
  unknownRequiredSlot: number | null;
  fingerprints: {
    soundDialog: number;
    title: number;
    intro: number;
    gameplay: number;
    afterInput: number;
  };
  frames: {
    toSoundDialog: number;
    toTitle: number;
    toIntro: number;
    toGameplay: number;
  };
  calls: PlayableExtCall[];
  inputSequence: string[];
  failure: string | null;
};

export function frameChecksum(pixels: Uint16Array): number {
  let s = 0;
  for (const p of pixels) s = (s + p) >>> 0;
  return s;
}

/**
 * Real host input → Mythroad event → guest → application.
 * 24-frame dialog wait is a baseline cap, not the only check.
 */
export function runPlayablePath(rt: MythroadRuntime, opts: { entry?: string } = {}): PlayablePathResult {
  const inputSequence: string[] = [];
  const calls: PlayableExtCall[] = [];
  const fingerprints = {
    soundDialog: 0,
    title: 0,
    intro: 0,
    gameplay: 0,
    afterInput: 0,
  };
  const frames = { toSoundDialog: 0, toTitle: 0, toIntro: 0, toGameplay: 0 };
  let soundDialog = false;
  let titleScreen = false;
  let startGame = false;
  let gameplayFrame = false;
  let gameplayInput = false;
  let failure: string | null = null;

  rt.onExtCall = (code, out) => {
    calls.push({ code, kind: out.kind, r0: out.r0 | 0, insn: out.insnCount });
  };
  if (rt.ext) rt.ext.onExtCall = rt.onExtCall;
  try {
    rt.start(opts.entry ?? "start.mr");
    const dialog = waitChecksum(rt, GSSJXZ_FP.soundDialog, 32);
    frames.toSoundDialog = dialog.frames;
    fingerprints.soundDialog = dialog.sum;
    soundDialog = dialog.hit;
    if (!soundDialog) throw new Error(`sound dialog checksum ${dialog.sum}, expected ${GSSJXZ_FP.soundDialog}`);

    tap(rt, "SOFTRIGHT", inputSequence);
    const title = waitChecksum(rt, GSSJXZ_FP.title, 8);
    frames.toTitle = title.frames;
    fingerprints.title = title.sum;
    titleScreen = title.hit;
    if (!titleScreen) throw new Error(`title checksum ${title.sum}, expected ${GSSJXZ_FP.title}`);

    tap(rt, "FIRE", inputSequence);
    const intro = waitChecksum(rt, GSSJXZ_FP.intro, 80);
    frames.toIntro = intro.frames;
    fingerprints.intro = intro.sum;
    startGame = intro.hit;
    if (!startGame) throw new Error(`intro checksum ${intro.sum}, expected ${GSSJXZ_FP.intro}`);

    tap(rt, "FIRE", inputSequence);
    const map = waitChecksum(rt, GSSJXZ_FP.gameplay, 90);
    frames.toGameplay = map.frames;
    fingerprints.gameplay = map.sum;
    gameplayFrame =
      map.hit &&
      map.sum !== GSSJXZ_FP.soundDialog &&
      map.sum !== GSSJXZ_FP.title &&
      map.sum !== GSSJXZ_FP.intro &&
      rt.unknownRequiredSlot === null;
    if (!gameplayFrame) throw new Error(`gameplay checksum ${map.sum}, expected ${GSSJXZ_FP.gameplay}`);

    const before = map.sum;
    tap(rt, "DOWN", inputSequence);
    let after = before;
    for (let i = 0; i < 3; i++) after = stepFrame(rt);
    fingerprints.afterInput = after;
    gameplayInput = after !== before && rt.unknownRequiredSlot === null;
    if (!gameplayInput) throw new Error(`DOWN did not change gameplay checksum ${before}`);
  } catch (e) {
    failure = e instanceof Error ? e.message : String(e);
  }

  const unknownRequiredSlot = rt.unknownRequiredSlot;
  const ok =
    failure === null &&
    unknownRequiredSlot === null &&
    soundDialog &&
    titleScreen &&
    startGame &&
    gameplayFrame &&
    gameplayInput;

  return {
    ok,
    soundDialog,
    titleScreen,
    startGame,
    gameplayFrame,
    gameplayInput,
    unknownRequiredSlot,
    fingerprints,
    frames,
    calls,
    inputSequence,
    failure,
  };
}

function tap(rt: MythroadRuntime, key: string, seq: string[]): void {
  rt.input.press(key);
  if (!rt.step()) throw new Error(`press ${key}: step returned false`);
  seq.push(`${key} press`);
  rt.input.release(key);
  if (!rt.step()) throw new Error(`release ${key}: step returned false`);
  seq.push(`${key} release`);
}

function stepFrame(rt: MythroadRuntime): number {
  rt.advance(80);
  if (!rt.step()) throw new Error("timer step returned false");
  return frameChecksum(rt.screen.pixels);
}

function waitChecksum(
  rt: MythroadRuntime,
  target: number,
  maxFrames: number,
): { hit: boolean; frames: number; sum: number } {
  let sum = frameChecksum(rt.screen.pixels);
  if (sum === target) return { hit: true, frames: 0, sum };
  for (let i = 1; i <= maxFrames; i++) {
    sum = stepFrame(rt);
    if (sum === target) return { hit: true, frames: i, sum };
  }
  return { hit: false, frames: maxFrames, sum };
}
