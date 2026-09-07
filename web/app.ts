import { SYSTEM_COMPONENTS } from "../src/mythroad/system-components.ts";
import { MRPArchive } from "../src/mrp/index.ts";
import { PlayerClient } from "./player-client.ts";
import { MR_MOUSE_DOWN, MR_MOUSE_UP, MR_MOUSE_MOVE } from "../src/mythroad/constants.ts";
import { inferScreenSize } from "../src/mythroad/device-size.ts";
import { EV_KEY } from "../src/mythroad/events.ts";
import { BrowserAudio } from "./audio.ts";
import { DOM_KEY, HeldKeys } from "./controls.ts";
import { assetUrl, readGame, readLibrary } from "./library.ts";
import { rotatedDirection, screenPoint } from "./player-options.ts";

let rotation = 0, speed = 1;
const editorDialog = document.querySelector<HTMLDialogElement>("#guest-editor")!;
const editorText = document.querySelector<HTMLInputElement>("#guest-editor-text")!;
let editingRuntime: PlayerClient | null = null;
document.querySelector("#guest-editor-form")!.addEventListener("submit", ev => { ev.preventDefault(); editingRuntime?.finishEdit(editorText.value, true); });
document.querySelector("#guest-editor-cancel")!.addEventListener("click", () => editingRuntime?.finishEdit(editorText.value, false));
editorDialog.addEventListener("cancel", ev => { ev.preventDefault(); editingRuntime?.finishEdit(editorText.value, false); });
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
const audio = new BrowserAudio();
const midiPlayer = document.querySelector<HTMLSelectElement>("#midi-player")!;
try { audio.setMidiPlayer(localStorage.getItem("flymrp.midi-player") === "simple" ? "simple" : "tinysynth"); } catch { /* storage is optional */ }
midiPlayer.value = audio.midiPlayer;
midiPlayer.addEventListener("change", () => {
  audio.setMidiPlayer(midiPlayer.value === "simple" ? "simple" : "tinysynth");
  try { localStorage.setItem("flymrp.midi-player", audio.midiPlayer); } catch { /* storage is optional */ }
});
type Session = { rt: PlayerClient; raf: number; last: number; title: string; nextHud: number };
let session: Session | null = null;
let loadingRuntime: PlayerClient | null = null;
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
  if (session) { cancelAnimationFrame(session.raf); session.rt.stop(); }
  loadingRuntime?.stop(); loadingRuntime = null;
  session = null;
  audio.stopAll();
  stopBtn.disabled = true;
  pauseBtn.disabled = true;
  pauseBtn.textContent = "暂停";
  paused = false;
  fpsEl.textContent = "— FPS";
  if (!keepStatus) setStatus("已停止。选择游戏即可重新加载。");
}
function fail(e: unknown, rt?: PlayerClient): void {
  const exited = rt?.exited;
  stop(true);
  setStatus(exited ? "游戏已退出，可重新加载。" : `运行失败：${e instanceof Error ? e.message : String(e)}`, !exited);
}
function frame(now: number): void {
  const s = session;
  if (!s) return;
  if (paused) { s.last = now; s.raf = requestAnimationFrame(frame); return; }
  try {
    s.rt.tick(now - s.last, speed);
    s.last = now;
    if (s.rt.exited) { stop(true); setStatus("游戏已退出，可重新加载。"); return; }
    if (now >= s.nextHud) {
      setStatus(`${s.title} · ${s.rt.screenW}×${s.rt.screenH} · 运行中${audio.lastError ? ` · 声音：${audio.lastError}` : ""}`);
      s.nextHud = now + 500;
      const elapsed = now - fpsStart;
      if (elapsed >= 500) { fpsEl.textContent = `${Math.round((s.rt.frames - frames) * 1000 / elapsed)} FPS`; frames = s.rt.frames; fpsStart = now; }
    }
    s.raf = requestAnimationFrame(frame);
  } catch (e) { fail(e, s.rt); }
}
async function ensureFont(): Promise<void> {
  if (systemFiles["system/gb16.uc2"] && systemFiles["system/gb12.uc2"]) return;
  fontPromise ??= (async () => {
    await Promise.all(SYSTEM_COMPONENTS.map(async name => {
      const res = await fetch(assetUrl(name));
      if (!res.ok) throw new Error(`缺少运行组件 ${name}`);
      systemFiles[name] = new Uint8Array(await res.arrayBuffer());
    }));
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
  let rt: PlayerClient | undefined;
  try {
    const [buffer] = await Promise.all([read(), ensureFont()]);
    if (token !== generation) return;
    setStatus("正在启动游戏，请稍候…");
    await new Promise<void>(resolve => setTimeout(resolve, 40));
    if (token !== generation) return;
    canvas.width = profile.width;
    canvas.height = profile.height;
    fitScreen();
    const packName = MRPArchive.parse(new Uint8Array(buffer)).header.filename;
    const localFiles = { ...await loadLocalSystem(), ...await loadLocalSystem(packName) };
    if (token !== generation) return;
    rt = new PlayerClient(canvas, { edit: state => {
      if (!state) { if (editorDialog.open) editorDialog.close(); editingRuntime = null; canvas.focus(); return; }
      editingRuntime = rt ?? null;
      document.querySelector("#guest-editor-title")!.textContent = state.title || "游戏输入";
      editorText.type = state.type === 2 ? "password" : "text";
      editorText.inputMode = state.type === 1 ? "numeric" : "text";
      editorText.maxLength = state.maxLength; editorText.value = state.text;
      if (!editorDialog.open) editorDialog.showModal(); editorText.focus();
    }, sound: (type, data, loop) => audio.play(type, data, loop), soundStop: type => audio.stop(type),
      error: error => { if (token === generation) fail(error, rt); } });
    loadingRuntime = rt;
    const guestTitle = await rt.start({ type: 'start', bytes: buffer, files: { ...systemFiles, ...localFiles }, profile });
    if (token !== generation) return;
    loadingRuntime = null;
    const title = guestTitle || name.split('/').at(-1)!;
    session = { rt, raf: 0, last: performance.now(), nextHud: 0, title };
    titleEl.textContent = title;
    pauseBtn.disabled = false;
    frames = rt.frames; fpsStart = performance.now();
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
    fpsStart = session.last; frames = session.rt.frames;
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
  } catch { setStatus("此浏览器暂不支持全屏，可隐藏虚拟键盘扩大画面。"); }
});
document.addEventListener("fullscreenchange", () => {
  const button = document.querySelector<HTMLButtonElement>("#fullscreen")!;
  button.setAttribute("aria-pressed", String(Boolean(document.fullscreenElement)));
  button.setAttribute("aria-label", document.fullscreenElement ? "退出全屏" : "全屏");
  button.title = document.fullscreenElement ? "退出全屏" : "进入全屏";
});
window.addEventListener("keydown", ev => {
  if (!session || paused || (ev.target instanceof HTMLElement && ev.target.closest("input, select, textarea, button, summary"))) return;
  const alias = ev.key === "*" ? "STAR" : ev.key === "#" ? "POUND" : DOM_KEY[ev.code];
  if (!alias) return;
  ev.preventDefault();
  audio.resume();
  held.press(`keyboard:${ev.code}`, rotatedDirection(alias, rotation));
});
window.addEventListener("keyup", ev => held.release(`keyboard:${ev.code}`));
function releaseAll(): void {
  held.clear();
  document.querySelectorAll("[data-key].held").forEach(button => button.classList.remove("held"));
  if (touch !== null && session) session.rt.queueEvent(EV_KEY, MR_MOUSE_UP, 0, 0);
  touch = null;
}
window.addEventListener("blur", releaseAll);
document.addEventListener("visibilitychange", () => { if (document.hidden) releaseAll(); });
let activationId = 0;
for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-key]")) {
  let pointerActivated = false;
  const pointers = new Map<number, { source: string; start: number }>();
  btn.addEventListener("pointerdown", ev => {
    ev.preventDefault();
    if (!session || paused) return;
    btn.setPointerCapture(ev.pointerId);
    audio.resume();
    pointerActivated = true;
    const source = `pointer:${ev.pointerId}:${++activationId}`;
    pointers.set(ev.pointerId, { source, start: performance.now() });
    btn.classList.add("held");
    held.press(source, rotatedDirection(btn.dataset.key!, rotation));
  });
  const release = (ev: PointerEvent) => {
    const pointer = pointers.get(ev.pointerId);
    if (!pointer) return;
    pointers.delete(ev.pointerId); btn.classList.remove("held");
    const delay = ev.type === "pointercancel" ? 0 : Math.max(0, 80 - (performance.now() - pointer.start));
    setTimeout(() => held.release(pointer.source), delay);
  };
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
    held.press(source, rotatedDirection(btn.dataset.key!, rotation));
    setTimeout(() => held.release(source), 120);
  });
}
function touchEvent(ev: PointerEvent, type: number): void {
  if (!session) return;
  const rect = canvas.getBoundingClientRect();
  const [x, y] = screenPoint((ev.clientX - rect.left) / rect.width, (ev.clientY - rect.top) / rect.height, canvas.width, canvas.height, rotation);
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


const stage = document.querySelector<HTMLElement>('#stage')!;
const viewport = document.querySelector<HTMLElement>('#screen-viewport')!;
const shell = document.querySelector<HTMLElement>('#screen-shell')!;
const keypad = document.querySelector<HTMLElement>('#keypad')!;
const zoomSelect = document.querySelector<HTMLSelectElement>('#zoom')!;
const rotationSelect = document.querySelector<HTMLSelectElement>('#rotation')!;
function fitScreen(): void {
  if (!stage) return;
  const swapped = rotation % 2 !== 0;
  const width = swapped ? canvas.height : canvas.width, height = swapped ? canvas.width : canvas.height;
  const fit = Math.max(.1, Math.min((stage.clientWidth - 32) / width, (stage.clientHeight - 26) / height));
  const scale = zoomSelect.value === 'auto' ? fit : Math.min(fit, Number(zoomSelect.value));
  canvas.style.width = `${canvas.width * scale}px`; canvas.style.height = `${canvas.height * scale}px`;
  viewport.style.width = `${width * scale + 10}px`; viewport.style.height = `${height * scale + 10}px`;
  shell.style.transform = `translate(-50%, -50%) rotate(${rotation * 90}deg)`;
}
function storeSetting(name: string, value: string): void { try { localStorage.setItem(`flymrp.${name}`, value); } catch {} }
function bindSelect(id: string, apply: (value: string) => void): void {
  const select = document.querySelector<HTMLSelectElement>(`#${id}`)!;
  try { const saved = localStorage.getItem(`flymrp.${id}`); if ([...select.options].some(option => option.value === saved)) select.value = saved!; } catch {}
  apply(select.value);
  select.addEventListener('change', () => { storeSetting(id, select.value); apply(select.value); canvas.focus(); });
}
bindSelect('zoom', fitScreen);
bindSelect('speed', value => { speed = Number(value); });
bindSelect('rotation', value => { releaseAll(); rotation = Number(value); fitScreen(); });
bindSelect('keypad-side', value => keypad.classList.toggle('reverse', value === 'reverse'));
bindSelect('resolution', () => {});
function rotate(delta: number): void { rotationSelect.value = String((rotation + delta + 4) % 4); rotationSelect.dispatchEvent(new Event('change')); }
document.querySelector('#rotate-left')!.addEventListener('click', () => rotate(-1));
document.querySelector('#rotate-right')!.addEventListener('click', () => rotate(1));
document.querySelector('#close-settings')!.addEventListener('click', () => setDrawer(false));
const keyboardButton = document.querySelector<HTMLButtonElement>('#toggle-keypad')!;
function showKeyboard(show: boolean): void {
  releaseAll(); keypad.hidden = !show; keyboardButton.setAttribute('aria-pressed', String(show)); keyboardButton.setAttribute('aria-label', show ? '隐藏虚拟键盘' : '显示虚拟键盘'); storeSetting('keypad', String(show)); fitScreen();
}
try { showKeyboard(localStorage.getItem('flymrp.keypad') !== 'false'); } catch {}
keyboardButton.addEventListener('click', () => showKeyboard(keypad.hidden));
const showFps = document.querySelector<HTMLInputElement>('#show-fps')!;
try { showFps.checked = localStorage.getItem('flymrp.show-fps') !== 'false'; } catch {}
fpsEl.hidden = !showFps.checked;
showFps.addEventListener('change', () => { fpsEl.hidden = !showFps.checked; storeSetting('show-fps', String(showFps.checked)); });
const volume = document.querySelector<HTMLInputElement>('#volume')!;
const mute = document.querySelector<HTMLButtonElement>('#mute')!;
let muted = false;
try { const saved = localStorage.getItem('flymrp.volume'); if (saved !== null && Number.isFinite(Number(saved))) volume.value = String(Math.min(100, Math.max(0, Number(saved)))); muted = localStorage.getItem('flymrp.muted') === 'true'; } catch {}
function applyVolume(): void {
  audio.setVolume(Number(volume.value) / 100); audio.setMuted(muted);
  document.querySelector('#volume-value')!.textContent = `${volume.value}%`;
  mute.setAttribute('aria-pressed', String(muted)); mute.setAttribute('aria-label', muted ? '开启声音' : '静音');
  mute.title = muted ? '开启声音' : '静音';
  storeSetting('volume', volume.value); storeSetting('muted', String(muted));
}
volume.addEventListener('input', () => { applyVolume(); audio.resume(); });
mute.addEventListener('click', () => { muted = !muted; applyVolume(); if (!muted) audio.resume(); });
applyVolume();
try { document.documentElement.dataset.theme = localStorage.getItem('flymrp.theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); } catch {}
document.querySelector('#theme')!.addEventListener('click', () => storeSetting('theme', document.documentElement.dataset.theme!));
new ResizeObserver(fitScreen).observe(stage);
new MutationObserver(fitScreen).observe(canvas, { attributes: true, attributeFilter: ['width', 'height'] });
document.querySelector('#screenshot')!.addEventListener('click', () => {
  canvas.toBlob(blob => {
    if (!blob) return;
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `${titleEl.textContent || 'flymrp'}.png`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
});
document.querySelector('#back')!.addEventListener('click', () => { stop(); if (window.parent !== window) window.parent.postMessage({ type: 'flymrp:close' }, location.origin); else location.href = assetUrl('./'); });
window.addEventListener('pagehide', () => stop(true));
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== window.parent || event.source === window) return;
  if (event.data?.type === 'flymrp:file' && event.data.file instanceof File) { const file = event.data.file; void start(file.name, () => file.arrayBuffer()); }
});
if (window.parent !== window) window.parent.postMessage({ type: 'flymrp:ready' }, location.origin);
const selectedName = new URL(location.href).searchParams.get('game');
if (selectedName) void (async () => {
  try { const game = (await readLibrary()).find(game => game.name === selectedName); if (!game) throw new Error('游戏不在精选清单中，请从游戏库选择或打开本地文件。'); await start(game.name, () => readGame(game)); }
  catch (error) { fail(error); }
})();
