import { DEFAULT_NETWORK_RULES } from "../src/mythroad/network-rules.ts";
import { SYSTEM_COMPONENTS } from "../src/mythroad/system-components.ts";
import { binToBytes, MRPArchive } from "../src/mrp/index.ts";
import { Canvas2DBackend, gb16Uc2Loaded, loadGb16Uc2, MythroadRuntime, type Canvas2DContextLike } from "../src/mythroad/index.ts";
import { MR_MOUSE_DOWN, MR_MOUSE_UP, MR_MOUSE_MOVE } from "../src/mythroad/constants.ts";
import { inferScreenSize } from "../src/mythroad/device-size.ts";
import { EV_KEY } from "../src/mythroad/events.ts";
import { BrowserAudio } from "./audio.ts";
import { DOM_KEY, HeldKeys } from "./controls.ts";

const networkRules = DEFAULT_NETWORK_RULES;
const assetUrl = (path: string): string => new URL(path, document.baseURI).href;
const editorDialog = document.querySelector<HTMLDialogElement>("#guest-editor")!;
const editorText = document.querySelector<HTMLInputElement>("#guest-editor-text")!;
let editingRuntime: MythroadRuntime | null = null;
document.querySelector("#guest-editor-form")!.addEventListener("submit", ev => { ev.preventDefault(); editingRuntime?.mrTable?.editor.finish(editorText.value, true); });
document.querySelector("#guest-editor-cancel")!.addEventListener("click", () => editingRuntime?.mrTable?.editor.finish(editorText.value, false));
editorDialog.addEventListener("cancel", ev => { ev.preventDefault(); editingRuntime?.mrTable?.editor.finish(editorText.value, false); });
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
const midiPlayer = document.querySelector<HTMLSelectElement>("#midi-player")!;
try { audio.setMidiPlayer(localStorage.getItem("flymrp.midi-player") === "simple" ? "simple" : "tinysynth"); } catch { /* storage is optional */ }
midiPlayer.value = audio.midiPlayer;
midiPlayer.addEventListener("change", () => {
  audio.setMidiPlayer(midiPlayer.value === "simple" ? "simple" : "tinysynth");
  try { localStorage.setItem("flymrp.midi-player", audio.midiPlayer); } catch { /* storage is optional */ }
});
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
  if (editorDialog.open) editorDialog.close();
  editingRuntime = null;
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
    if (s.rt.exited) { stop(true); setStatus("游戏已退出，可重新加载。"); return; }
    if (now >= s.nextHud) {
      setStatus(`${s.title} · ${s.rt.screenW}×${s.rt.screenH} · 运行中${audio.lastError ? ` · 声音：${audio.lastError}` : ""}`);
      s.nextHud = now + 500;
      const elapsed = now - fpsStart;
      if (elapsed >= 500) { fpsEl.textContent = `${Math.round(frames * 1000 / elapsed)} FPS`; frames = 0; fpsStart = now; }
    }
    frames++;
    s.raf = requestAnimationFrame(frame);
  } catch (e) { fail(e, s.rt); }
}
async function ensureFont(): Promise<void> {
  if (gb16Uc2Loaded() && systemFiles["system/gb12.uc2"]) return;
  fontPromise ??= (async () => {
    await Promise.all(SYSTEM_COMPONENTS.map(async name => {
      const res = await fetch(assetUrl(name));
      if (!res.ok) throw new Error(`缺少运行组件 ${name}`);
      systemFiles[name] = new Uint8Array(await res.arrayBuffer());
    }));
    loadGb16Uc2(systemFiles["system/gb16.uc2"]);
  })().catch(e => { fontPromise = null; throw e; });
  await fontPromise;
}
const localBlobCache = new Map<string, Uint8Array>();
async function loadLocalSystem(packName?: string): Promise<Record<string, Uint8Array>> {
  const endpoint = packName ? "/__resources" : "/__system";
  if (import.meta.env.PROD && !packName) return {};
  const res = import.meta.env.PROD ? new Response(null, { status: 404 }) : await fetch(endpoint + (packName ? `?game=${encodeURIComponent(packName)}` : ""));
  // Static hosting has no optional local directory endpoint.
  let manifest: { name: string; sha256: string; size: number }[];
  let staticResources = false;
  if (res.status === 404 || (res.ok && !res.headers.get("content-type")?.includes("application/json"))) {
    if (!packName) return {};
    const index = await fetch(assetUrl("mythroad_res/index.json"));
    if (index.status === 404 || (index.ok && !index.headers.get("content-type")?.includes("application/json"))) return {};
    if (!index.ok) throw new Error("无法读取游戏资源清单");
    manifest = (await index.json()).groups[packName.replace(/\.mrp$/i, "").toLowerCase()] ?? [];
    staticResources = true;
  } else {
    if (!res.ok) throw new Error("无法读取本地 mythroad 资源目录");
    manifest = await res.json();
  }
  const files: Record<string, Uint8Array> = {};
  await Promise.all(manifest.map(async item => {
    let bytes = localBlobCache.get(item.sha256);
    if (!bytes) {
      const response = await fetch(staticResources ? assetUrl(`mythroad_res/${item.name.split("/").map(encodeURIComponent).join("/")}`) : `${endpoint}/${item.sha256}`);
      if (!response.ok) throw new Error(`无法读取本地组件 ${item.name}`);
      const buffer = await response.arrayBuffer();
      bytes = new Uint8Array(buffer);
      const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))].map(b => b.toString(16).padStart(2, "0")).join("");
      if (bytes.length !== item.size || digest !== item.sha256) throw new Error(`本地组件已改变：${item.name}，请重新加载`);
      localBlobCache.set(item.sha256, bytes);
    }
    files[item.name] = bytes;
  }));
  let cachedBytes = [...localBlobCache.values()].reduce((sum, bytes) => sum + bytes.length, 0);
  for (const [hash, bytes] of localBlobCache) { if (cachedBytes <= 64 * 1024 * 1024) break; localBlobCache.delete(hash); cachedBytes -= bytes.length; }
  return files;
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
    const packName = MRPArchive.parse(new Uint8Array(buffer)).header.filename;
    const localFiles = { ...await loadLocalSystem(), ...await loadLocalSystem(packName) };
    if (token !== generation) return;
    loadGb16Uc2(localFiles["system/gb16.uc2"] ?? systemFiles["system/gb16.uc2"]);
    rt = new MythroadRuntime({ networkRules, onEditChange: state => {
      if (!state) { if (editorDialog.open) editorDialog.close(); editingRuntime = null; canvas.focus(); return; }
      editingRuntime = rt ?? null;
      document.querySelector("#guest-editor-title")!.textContent = state.title || "游戏输入";
      editorText.type = state.type === 2 ? "password" : "text";
      editorText.inputMode = state.type === 1 ? "numeric" : "text";
      editorText.maxLength = state.maxLength; editorText.value = state.text;
      if (!editorDialog.open) editorDialog.showModal(); editorText.focus();
    }, systemFiles: { ...systemFiles, ...localFiles }, profile, graphics: gfx, abiMode: "strict",
      onPlaySound: (type, data, loop) => audio.play(type, data, loop), onStopSound: type => audio.stop(type) });
    const archive = rt.loadMrp(new Uint8Array(buffer));
    rt.start();
    // Only the guest's flush presents a frame. Between callbacks the guest may
    // already have cleared dialogue/sprites to prepare its next background.
    // Yield between boot ticks so stop/reload stays responsive during animations.
    for (let i = 0; i < 32; i++) {
      rt.advance(80);
      for (let j = 0; j < 16 && rt.step(); j++);
      if (i % 4 === 0) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        if (token !== generation) return;
      }
    }
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
let activationId = 0;
for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-key]")) {
  let pointerActivated = false;
  btn.addEventListener("pointerdown", ev => {
    ev.preventDefault();
    if (!session || paused) return;
    btn.setPointerCapture(ev.pointerId);
    audio.resume();
    pointerActivated = true;
    held.press(`pointer:${ev.pointerId}`, btn.dataset.key!);
  });
  const release = (ev: PointerEvent) => held.release(`pointer:${ev.pointerId}`);
  btn.addEventListener("pointerup", release);
  btn.addEventListener("pointercancel", release);
  btn.addEventListener("pointercancel", () => { pointerActivated = false; });
  btn.addEventListener("lostpointercapture", release);
  // Keyboard/assistive activation emits click without pointerdown/up. Keep its
  // key down briefly so games that poll the keypad can observe the activation.
  btn.addEventListener("click", ev => {
    const alreadyHandled = pointerActivated && ev.detail !== 0;
    pointerActivated = false;
    if (alreadyHandled || !session || paused) return;
    const source = `activation:${++activationId}`;
    audio.resume();
    held.press(source, btn.dataset.key!);
    setTimeout(() => held.release(source), 120);
  });
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
type Game = { id: number; name: string; sha256?: string; title?: string; category?: string };
let games: Game[] = [];
function renderLibrary(): void {
  const term = search.value.trim().toLowerCase();
  const matches = games.filter(game => `${game.title ?? ""} ${game.category ?? ""} ${game.name}`.toLowerCase().includes(term));
  gameSelect.replaceChildren(...matches.slice(0, 100).map(game => {
    const option = new Option(game.title ?? game.name.split("/").at(-1)!.replace(/\.mrp$/i, ""), String(game.id));
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
    const response = await fetch(import.meta.env.PROD ? assetUrl(`games/${game.name.split("/").map(encodeURIComponent).join("/")}${game.sha256 ? `?v=${encodeURIComponent(game.sha256)}` : ""}`) : `/__games/${game.id}`);
    if (!response.ok) throw new Error("无法读取游戏文件");
    return response.arrayBuffer();
  });
});
const refreshLibrary = document.querySelector<HTMLButtonElement>("#refresh-library")!;
async function reloadLibrary(): Promise<void> {
  refreshLibrary.disabled = true;
  try {
    const response = await fetch(import.meta.env.PROD ? assetUrl("games/index.json") : "/__games", { cache: "no-cache" });
    if (!response.ok) throw new Error("无法刷新精选游戏库");
    const selectedName = games.find(game => String(game.id) === gameSelect.value)?.name;
    games = await response.json();
    document.querySelector<HTMLElement>("#library")!.hidden = !games.length;
    renderLibrary();
    const selected = games.find(game => game.name === selectedName);
    if (selected && [...gameSelect.options].some(option => option.value === String(selected.id))) gameSelect.value = String(selected.id);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally { refreshLibrary.disabled = false; }
}
refreshLibrary.addEventListener("click", () => { void reloadLibrary(); });
void reloadLibrary();
