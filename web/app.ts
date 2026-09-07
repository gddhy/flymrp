import { binToBytes } from "../src/mrp/index.ts";
import { Canvas2DBackend, gb16Uc2Loaded, loadGb16Uc2, MythroadRuntime, type Canvas2DContextLike } from "../src/mythroad/index.ts";
import { MR_MOUSE_DOWN, MR_MOUSE_UP, MR_MOUSE_MOVE } from "../src/mythroad/constants.ts";
import { inferScreenSize } from "../src/mythroad/device-size.ts";
import { EV_KEY } from "../src/mythroad/events.ts";
import { BrowserAudio } from "./audio.ts";
import { DOM_KEY, HeldKeys } from "./controls.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#screen")!;
const fileInput = document.querySelector<HTMLInputElement>("#file")!;
const stopBtn = document.querySelector<HTMLButtonElement>("#stop")!;
const resolution = document.querySelector<HTMLSelectElement>("#resolution")!;
const statusEl = document.querySelector<HTMLElement>("#status")!;
const pauseBtn = document.querySelector<HTMLButtonElement>("#pause")!;
const restartBtn = document.querySelector<HTMLButtonElement>("#restart")!;
const titleEl = document.querySelector<HTMLElement>("#game-title")!;
const fpsEl = document.querySelector<HTMLElement>("#fps")!;
const emptyScreen = document.querySelector<HTMLElement>("#empty-screen")!;
let paused = false;
let frames = 0;
let fpsStart = 0;
let lastGame: { name: string; read: () => Promise<ArrayBuffer> } | null = null;
const rawCtx = canvas.getContext("2d", { alpha: false, desynchronized: true });
if (!rawCtx) throw new Error("Canvas2D unavailable");
const ctx: Canvas2DContextLike = rawCtx;
const audio = new BrowserAudio();
type Session = { rt: MythroadRuntime; gfx: Canvas2DBackend; raf: number; last: number; title: string; nextHud: number };
let session: Session | null = null;
let generation = 0;
let fontPromise: Promise<void> | null = null;
const systemFiles: Record<string, Uint8Array> = {};
let touch: number | null = null;
const held = new HeldKeys(key => session?.rt.input.press(key), key => session?.rt.input.release(key));

function setStatus(text: string, err = false): void {
  statusEl.textContent = text;
  statusEl.classList.toggle("err", err);
}
function stop(keepStatus = false): void {
  generation++;
  held.clear();
  touch = null;
  if (session) cancelAnimationFrame(session.raf);
  session = null;
  audio.stopAll();
  stopBtn.disabled = true;
  pauseBtn.disabled = true;
  pauseBtn.textContent = "暂停";
  paused = false;
  fpsEl.textContent = "— FPS";
  if (!keepStatus) setStatus("已停止。选择游戏即可重新加载。");
}
function present(s: Pick<Session, "rt" | "gfx">): void { s.gfx.flush(0, 0, s.rt.screenW, s.rt.screenH, 0); }
function fail(e: unknown, rt?: MythroadRuntime): void {
  const exited = rt?.exited;
  stop(true);
  setStatus(exited ? "游戏已退出，可重新加载。" : `运行失败：${e instanceof Error ? e.message : String(e)}`, !exited);
}
function frame(now: number): void {
  const s = session;
  if (!s) return;
  if (paused) { s.last = now; s.raf = requestAnimationFrame(frame); return; }
  try {
    s.rt.advance(Math.max(0, Math.min(100, now - s.last)));
    s.last = now;
    for (let i = 0; i < 16 && s.rt.step(); i++);
    present(s);
    if (s.rt.exited) { stop(true); setStatus("游戏已退出，可重新加载。"); return; }
    if (now >= s.nextHud) {
      setStatus(`${s.title} · ${s.rt.screenW}×${s.rt.screenH} · 运行中${audio.lastError ? ` · 声音：${audio.lastError}` : ""}`);
      s.nextHud = now + 500;
      const elapsed = now - fpsStart;
      if (elapsed >= 500) { fpsEl.textContent = `${Math.round(frames * 1000 / elapsed)} FPS`; frames = 0; fpsStart = now; }
    }
    frames++;
    s.raf = requestAnimationFrame(frame);
  } catch (e) { present(s); fail(e, s.rt); }
}
async function ensureFont(): Promise<void> {
  if (gb16Uc2Loaded() && systemFiles["system/gb12.uc2"]) return;
  fontPromise ??= (async () => {
    await Promise.all(["system/gb16.uc2", "system/gb12.uc2", "system/gb12_uc2.adl", "system/gb16_uc2.adl", "plugins/netpay.mrp"].map(async name => {
      const res = await fetch(`/${name}`);
      if (!res.ok) throw new Error(`缺少运行组件 ${name}`);
      systemFiles[name] = new Uint8Array(await res.arrayBuffer());
    }));
    loadGb16Uc2(systemFiles["system/gb16.uc2"]);
  })().catch(e => { fontPromise = null; throw e; });
  await fontPromise;
}
async function start(name: string, read: () => Promise<ArrayBuffer>): Promise<void> {
  stop(true);
  lastGame = { name, read };
  restartBtn.disabled = false;
  titleEl.textContent = name.split("/").at(-1)!.replace(/\.mrp$/i, "");
  emptyScreen.hidden = true;
  const token = generation;
  const profile = resolution.value === "auto" ? inferScreenSize(name) : inferScreenSize(resolution.value);
  stopBtn.disabled = false;
  audio.resume();
  setStatus(`正在读取 ${name.split("/").at(-1)}…`);
  let rt: MythroadRuntime | undefined;
  try {
    const [buffer] = await Promise.all([read(), ensureFont()]);
    if (token !== generation) return;
    setStatus("正在启动游戏，请稍候…");
    await new Promise<void>(resolve => setTimeout(resolve, 40));
    if (token !== generation) return;
    canvas.width = profile.width;
    canvas.height = profile.height;
    canvas.style.setProperty("--screen-ratio", `${profile.width} / ${profile.height}`);
    const gfx = new Canvas2DBackend(ctx, () => rt!.screen);
    rt = new MythroadRuntime({ systemFiles, profile, graphics: gfx, abiMode: "strict",
      onPlaySound: (type, data, loop) => audio.play(type, data, loop), onStopSound: type => audio.stop(type) });
    const archive = rt.loadMrp(new Uint8Array(buffer));
    try {
      rt.start();
      // Yield between boot ticks so stop/reload stays responsive during animations.
      for (let i = 0; i < 32; i++) {
        rt.advance(80);
        for (let j = 0; j < 16 && rt.step(); j++);
        if (i % 4 === 0) {
          present({ rt, gfx });
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
          if (token !== generation) return;
        }
      }
    } finally { if (token === generation) present({ rt, gfx }); }
    if (token !== generation) return;
    const title = archive.header.appname ? new TextDecoder("gbk").decode(binToBytes(archive.header.appname)) : name.split("/").at(-1)!;
    session = { rt, gfx, raf: 0, last: performance.now(), nextHud: 0, title };
    titleEl.textContent = title;
    pauseBtn.disabled = false;
    frames = 0; fpsStart = performance.now();
    if (window.matchMedia("(max-width: 760px)").matches) setDrawer(false);
    canvas.focus();
    session.raf = requestAnimationFrame(frame);
  } catch (e) { if (token === generation) fail(e, rt); }
}
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  fileInput.value = ""; // Same game can be selected again after failure or exit.
  if (file) void start(file.name, () => file.arrayBuffer());
});
stopBtn.addEventListener("click", () => stop());
pauseBtn.addEventListener("click", () => {
  if (!session) return;
  releaseAll();
  try {
    if (paused) session.rt.resume(); else session.rt.pause();
    paused = !paused;
    pauseBtn.textContent = paused ? "继续" : "暂停";
    session.last = performance.now();
    fpsStart = session.last; frames = 0;
    setStatus(paused ? "已暂停" : "运行中");
  } catch (e) { fail(e, session.rt); }
});
restartBtn.addEventListener("click", () => { if (lastGame) void start(lastGame.name, lastGame.read); });
const drawer = document.querySelector<HTMLElement>("#game-drawer")!;
const libraryToggle = document.querySelector<HTMLButtonElement>("#library-toggle")!;
function setDrawer(open: boolean): void { drawer.hidden = !open; libraryToggle.setAttribute("aria-expanded", String(open)); }
libraryToggle.addEventListener("click", () => setDrawer(drawer.hidden));
document.querySelector("#theme")!.addEventListener("click", () => {
  document.documentElement.dataset.theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
});
document.querySelector("#fullscreen")!.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { setStatus("此浏览器暂不支持全屏，可收起游戏库扩大画面。"); }
});
window.addEventListener("keydown", ev => {
  if (!session || paused || (ev.target instanceof HTMLElement && ev.target.closest("input, select, textarea, button, summary"))) return;
  const alias = ev.key === "*" ? "STAR" : ev.key === "#" ? "POUND" : DOM_KEY[ev.code];
  if (!alias) return;
  ev.preventDefault();
  audio.resume();
  held.press(`keyboard:${ev.code}`, alias);
});
window.addEventListener("keyup", ev => held.release(`keyboard:${ev.code}`));
function releaseAll(): void {
  held.clear();
  if (touch !== null && session) session.rt.queueEvent(EV_KEY, MR_MOUSE_UP, 0, 0);
  touch = null;
}
window.addEventListener("blur", releaseAll);
document.addEventListener("visibilitychange", () => { if (document.hidden) releaseAll(); });
for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-key]")) {
  btn.addEventListener("pointerdown", ev => {
    ev.preventDefault();
    if (!session || paused) return;
    btn.setPointerCapture(ev.pointerId);
    audio.resume();
    held.press(`pointer:${ev.pointerId}`, btn.dataset.key!);
  });
  const release = (ev: PointerEvent) => held.release(`pointer:${ev.pointerId}`);
  btn.addEventListener("pointerup", release);
  btn.addEventListener("pointercancel", release);
  btn.addEventListener("lostpointercapture", release);
}
function touchEvent(ev: PointerEvent, type: number): void {
  if (!session) return;
  const rect = canvas.getBoundingClientRect();
  const x = Math.max(0, Math.min(canvas.width - 1, Math.floor((ev.clientX - rect.left) * canvas.width / rect.width)));
  const y = Math.max(0, Math.min(canvas.height - 1, Math.floor((ev.clientY - rect.top) * canvas.height / rect.height)));
  session.rt.queueEvent(EV_KEY, type, x, y);
}
canvas.addEventListener("pointerdown", ev => {
  if (!session || touch !== null) return;
  ev.preventDefault(); canvas.focus(); canvas.setPointerCapture(ev.pointerId);
  touch = ev.pointerId; touchEvent(ev, MR_MOUSE_DOWN);
});
canvas.addEventListener("pointermove", ev => { if (ev.pointerId === touch) touchEvent(ev, MR_MOUSE_MOVE); });
for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) canvas.addEventListener(type, ev => {
  if (ev.pointerId === touch) { touchEvent(ev, MR_MOUSE_UP); touch = null; }
});

const gameSelect = document.querySelector<HTMLSelectElement>("#games")!;
const search = document.querySelector<HTMLInputElement>("#search")!;
const loadGame = document.querySelector<HTMLButtonElement>("#load-game")!;
type Game = { id: number; name: string };
let games: Game[] = [];
function renderLibrary(): void {
  const term = search.value.trim().toLowerCase();
  const matches = games.filter(game => game.name.toLowerCase().includes(term));
  gameSelect.replaceChildren(...matches.slice(0, 100).map(game => {
    const option = new Option(game.name.split("/").at(-1)!.replace(/\.mrp$/i, ""), String(game.id));
    option.title = game.name;
    return option;
  }));
  gameSelect.selectedIndex = matches.length ? 0 : -1;
  document.querySelector("#library-count")!.textContent = `${matches.length} 款${matches.length > 100 ? "，显示前 100 款" : ""}`;
  loadGame.disabled = !matches.length;
}
search.addEventListener("input", renderLibrary);
loadGame.addEventListener("click", () => {
  const game = games.find(g => String(g.id) === gameSelect.value);
  if (!game) return;
  void start(game.name, async () => {
    const response = await fetch(`/__games/${game.id}`);
    if (!response.ok) throw new Error("无法读取本地游戏");
    return response.arrayBuffer();
  });
});
const refreshLibrary = document.querySelector<HTMLButtonElement>("#refresh-library")!;
async function reloadLibrary(): Promise<void> {
  refreshLibrary.disabled = true;
  try {
    const response = await fetch("/__games");
    if (!response.ok) throw new Error("无法刷新本地游戏库");
    const selected = gameSelect.value;
    games = await response.json();
    document.querySelector<HTMLElement>("#library")!.hidden = !games.length;
    renderLibrary();
    if ([...gameSelect.options].some(option => option.value === selected)) gameSelect.value = selected;
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally { refreshLibrary.disabled = false; }
}
refreshLibrary.addEventListener("click", () => { void reloadLibrary(); });
void reloadLibrary();
