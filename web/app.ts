import { binToBytes } from "../src/mrp/index.ts";
import {
  Canvas2DBackend,
  gb16Uc2Loaded,
  loadGb16Uc2,
  MythroadRuntime,
  type Canvas2DContextLike,
} from "../src/mythroad/index.ts";
import { BrowserAudio } from "./audio.ts";

const SCREEN_W = 240;
const SCREEN_H = 320;
const MAX_STEPS_PER_FRAME = 16;

const DOM_KEY: Record<string, string> = {
  ArrowUp: "UP",
  ArrowDown: "DOWN",
  ArrowLeft: "LEFT",
  ArrowRight: "RIGHT",
  KeyW: "UP",
  KeyS: "DOWN",
  KeyA: "LEFT",
  KeyD: "RIGHT",
  Enter: "FIRE",
  Space: "FIRE",
  KeyJ: "FIRE",
  ShiftLeft: "SOFTLEFT",
  KeyQ: "SOFTLEFT",
  Digit1: "SOFTLEFT",
  Escape: "SOFTRIGHT",
  Backspace: "SOFTRIGHT",
  KeyE: "SOFTRIGHT",
  Digit3: "SOFTRIGHT",
};

type Session = {
  rt: MythroadRuntime;
  gfx: Canvas2DBackend;
  raf: number;
  last: number;
  held: Set<string>;
  title: string;
};

const canvas = document.querySelector("#screen") as HTMLCanvasElement;
const fileInput = document.querySelector("#file") as HTMLInputElement;
const stopBtn = document.querySelector("#stop") as HTMLButtonElement;
const statusEl = document.querySelector("#status") as HTMLElement;
const rawCtx = canvas.getContext("2d", { alpha: false, desynchronized: true });
if (!rawCtx) throw new Error("Canvas2D unavailable");
const ctx: Canvas2DContextLike = rawCtx;
const audio = new BrowserAudio();

let session: Session | null = null;
let statusText = "";
let statusErr = false;

function setStatus(text: string, err = false): void {
  statusText = text;
  statusErr = err;
  statusEl.textContent = text;
  statusEl.classList.toggle("err", err);
}

function checksum(pixels: Uint16Array): number {
  let s = 0;
  for (const p of pixels) s = (s + p) >>> 0;
  return s;
}

/** MRP header strings are GBK bytes stored as binary JS strings. */
function gbkLabel(bin: string): string {
  if (!bin) return "";
  try {
    return new TextDecoder("gbk").decode(binToBytes(bin));
  } catch {
    return bin;
  }
}

/** Official boot paints 「请稍候」 first; the sound dialog needs ~22 timer ticks. */
function pumpBoot(rt: MythroadRuntime, frames = 32): void {
  for (let i = 0; i < frames; i++) {
    rt.advance(80);
    rt.step();
    if (rt.unknownRequiredSlot !== null) return;
  }
}

function present(gfx: Canvas2DBackend): void {
  gfx.flush(0, 0, SCREEN_W, SCREEN_H, 0);
}

function hud(s: Session): string {
  const slot = s.rt.unknownRequiredSlot;
  const snd = audio.lastType === null ? "off" : `t${audio.lastType}/${audio.lastLen}`;
  const err = audio.lastError ? ` audio:${audio.lastError}` : "";
  return `${s.title}  chk=${checksum(s.rt.screen.pixels)}  snd=${snd}${err}${slot === null ? "" : `  SLOT=${slot}`}`;
}

function stop(keepStatus = false): void {
  if (session) {
    cancelAnimationFrame(session.raf);
    for (const key of session.held) session.rt.input.release(key);
    session = null;
  }
  audio.stopAll();
  stopBtn.disabled = true;
  if (!keepStatus) setStatus("已停止。再选一个 .mrp 即可加载。");
}

function frame(now: number): void {
  const s = session;
  if (!s) return;
  try {
    present(s.gfx);
    const dt = Math.max(0, Math.min(100, now - s.last));
    s.last = now;
    if (dt > 0) s.rt.advance(dt);
    let n = 0;
    while (n < MAX_STEPS_PER_FRAME && s.rt.step()) n++;
    present(s.gfx);
    if (s.rt.unknownRequiredSlot !== null) {
      const slot = s.rt.unknownRequiredSlot;
      stop(true);
      setStatus(`UNKNOWN_REQUIRED_SLOT = ${slot}`, true);
      return;
    }
    if (!statusErr) setStatus(hud(s));
    s.raf = requestAnimationFrame(frame);
  } catch (e) {
    try {
      if (session) present(session.gfx);
    } catch {
      /* last frame may already be on canvas */
    }
    stop(true);
    setStatus(e instanceof Error ? e.message : String(e), true);
  }
}

async function ensureGb16(): Promise<void> {
  if (gb16Uc2Loaded()) return;
  const res = await fetch("/system/gb16.uc2");
  if (!res.ok) throw new Error("缺少 assets/system/gb16.uc2，无法渲染中文点阵");
  loadGb16Uc2(new Uint8Array(await res.arrayBuffer()));
}

async function startFromFile(file: File): Promise<void> {
  stop();
  audio.resume();
  setStatus(`正在读取 ${file.name}…`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  setStatus("正在加载字库…");
  await ensureGb16();
  setStatus("正在启动（首次可能卡几秒）…");
  await new Promise<void>((resolve) => setTimeout(resolve, 40));

  let rt!: MythroadRuntime;
  const gfx = new Canvas2DBackend(ctx, () => rt.screen);
  rt = new MythroadRuntime({
    graphics: gfx,
    abiMode: "strict",
    onPlaySound: (type, data, loop) => audio.play(type, data, loop),
    onStopSound: (type) => audio.stop(type),
  });
  const archive = rt.loadMrp(bytes);
  try {
    rt.start("start.mr");
    pumpBoot(rt);
  } finally {
    present(gfx);
  }
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  const title = gbkLabel(archive.header.appname) || archive.header.filename || file.name;
  session = { rt, gfx, raf: 0, last: performance.now(), held: new Set(), title };
  stopBtn.disabled = false;
  canvas.focus();
  setStatus(hud(session));
  session.raf = requestAnimationFrame(frame);
}

function press(alias: string): void {
  if (!session || session.held.has(alias)) return;
  audio.resume();
  session.held.add(alias);
  if (alias === "SOFTRIGHT" || alias === "SOFTLEFT") {
    setStatus("正在处理按键（解压资源时会卡几秒）…");
  }
  session.rt.input.press(alias);
}

function release(alias: string): void {
  if (!session || !session.held.has(alias)) return;
  session.held.delete(alias);
  session.rt.input.release(alias);
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  audio.resume();
  void startFromFile(file).catch((e) => {
    stop(true);
    setStatus(e instanceof Error ? e.message : String(e), true);
  });
});

stopBtn.addEventListener("click", () => {
  stop();
  fileInput.value = "";
});

window.addEventListener("keydown", (ev) => {
  const alias = DOM_KEY[ev.code];
  if (!alias || !session) return;
  ev.preventDefault();
  if (ev.repeat) return;
  press(alias);
});

window.addEventListener("keyup", (ev) => {
  const alias = DOM_KEY[ev.code];
  if (!alias) return;
  ev.preventDefault();
  release(alias);
});

window.addEventListener("blur", () => {
  if (!session) return;
  for (const key of [...session.held]) release(key);
});

for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-key]")) {
  const alias = btn.dataset.key;
  if (!alias) continue;
  const down = (ev: Event) => {
    ev.preventDefault();
    press(alias);
  };
  const up = (ev: Event) => {
    ev.preventDefault();
    release(alias);
  };
  btn.addEventListener("pointerdown", down);
  btn.addEventListener("pointerup", up);
  btn.addEventListener("pointerleave", up);
  btn.addEventListener("pointercancel", up);
}
