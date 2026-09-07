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
const rawCtx = canvas.getContext("2d", { alpha: false, desynchronized: true });
if (!rawCtx) throw new Error("Canvas2D unavailable");
const ctx: Canvas2DContextLike = rawCtx;
const audio = new BrowserAudio();
type Session = { rt: MythroadRuntime; gfx: Canvas2DBackend; raf: number; last: number; title: string; nextHud: number };
let session: Session | null = null;
let generation = 0;
let fontPromise: Promise<void> | null = null;
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
  try {
    s.rt.advance(Math.max(0, Math.min(100, now - s.last)));
    s.last = now;
    for (let i = 0; i < 16 && s.rt.step(); i++);
    present(s);
    if (s.rt.exited) { stop(true); setStatus("游戏已退出，可重新加载。"); return; }
    if (now >= s.nextHud) {
      setStatus(`${s.title} · ${s.rt.screenW}×${s.rt.screenH} · 运行中${audio.lastError ? ` · 声音：${audio.lastError}` : ""}`);
      s.nextHud = now + 500;
    }
    s.raf = requestAnimationFrame(frame);
  } catch (e) { present(s); fail(e, s.rt); }
}
async function ensureFont(): Promise<void> {
  if (gb16Uc2Loaded()) return;
  fontPromise ??= (async () => {
    const res = await fetch("/system/gb16.uc2");
    if (!res.ok) throw new Error("缺少 assets/system/gb16.uc2 中文字库");
    loadGb16Uc2(new Uint8Array(await res.arrayBuffer()));
  })().catch(e => { fontPromise = null; throw e; });
  await fontPromise;
}
async function start(name: string, read: () => Promise<ArrayBuffer>): Promise<void> {
  stop(true);
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
    rt = new MythroadRuntime({ profile, graphics: gfx, abiMode: "strict",
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
window.addEventListener("keydown", ev => {
  if (!session || (ev.target instanceof HTMLElement && ev.target.closest("input, select, textarea"))) return;
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
    if (!session) return;
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
  gameSelect.replaceChildren(...matches.slice(0, 100).map(game => new Option(game.name, String(game.id))));
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
void fetch("/__games").then(r => r.ok ? r.json() : []).then((data: Game[]) => {
  games = data;
  if (!games.length) return;
  document.querySelector<HTMLElement>("#library")!.hidden = false;
  renderLibrary();
}).catch(() => { /* Local file upload remains available without the dev library. */ });
