export type KaiOSKey = "up" | "down" | "left" | "right" | "enter" | "softLeft" | "softRight" | "back";
export type KaiOSKeyHandler = () => boolean | void;
export type KaiOSPageKeys = Partial<Record<KaiOSKey, KaiOSKeyHandler>>;
export type KaiOSMenuItem = { label: string; action: () => void };

export function detectKaiOS(input: { flag?: boolean; search?: string; ua?: string; b2g?: boolean }): boolean {
  if (input.flag) return true;
  if (/(?:^|[?&])kaios=(?:1|true)(?:&|$)/i.test(input.search ?? "")) return true;
  if (/KAIOS/i.test(input.ua ?? "")) return true;
  return Boolean(input.b2g);
}

export function isKaiOS(): boolean {
  if (typeof document === "undefined") return false;
  return detectKaiOS({
    flag: Boolean(import.meta.env.KAIOS),
    search: typeof location === "undefined" ? "" : location.search,
    ua: typeof navigator === "undefined" ? "" : navigator.userAgent,
    b2g: typeof navigator !== "undefined" && ("b2g" in navigator || "mozSetMessageHandler" in navigator),
  });
}

let pageKeys: KaiOSPageKeys | null = null;
let listening = false;
let alertOk: (() => void) | undefined;
let alertCancel: (() => void) | undefined;
let menuItems: KaiOSMenuItem[] = [];

export function setKaiOSPageKeys(handlers: KaiOSPageKeys): void { pageKeys = handlers; }

export function setSoftkeys(left: string, center: string, right: string): void {
  const set = (id: string, text: string): void => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  set("kaios-soft-left", left);
  set("kaios-soft-center", center);
  set("kaios-soft-right", right);
}

export function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (target as HTMLInputElement).type.toLowerCase();
    return type !== "button" && type !== "submit" && type !== "reset" && type !== "checkbox" && type !== "radio" && type !== "file" && type !== "range";
  }
  return target.isContentEditable;
}

export function moveFocus(container: ParentNode, selector: string, delta: number): HTMLElement | null {
  const items = Array.from(container.querySelectorAll<HTMLElement>(selector));
  if (!items.length) return null;
  let index = items.findIndex(item => item.classList.contains("focus"));
  if (index < 0) index = 0;
  else index = (index + delta + items.length) % items.length;
  for (const item of items) item.classList.remove("focus");
  const current = items[index];
  current.classList.add("focus");
  if (current.scrollIntoView) current.scrollIntoView(false);
  return current;
}

export function focusedItem(container: ParentNode, selector: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`${selector}.focus`) ?? container.querySelector<HTMLElement>(selector);
}

export function isMenuOpen(): boolean {
  const menu = document.getElementById("kaios-menu");
  return Boolean(menu && !menu.hidden);
}

export function closeMenu(): boolean {
  const menu = document.getElementById("kaios-menu");
  if (!menu || menu.hidden) return false;
  menu.hidden = true;
  menuItems = [];
  return true;
}

export function openMenu(items: KaiOSMenuItem[]): void {
  const menu = document.getElementById("kaios-menu");
  const list = document.getElementById("kaios-menu-items");
  if (!menu || !list) return;
  menuItems = items;
  list.textContent = "";
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "menuitem";
    row.textContent = item.label;
    row.addEventListener("click", () => runMenu(item));
    list.appendChild(row);
  }
  menu.hidden = false;
  if (items.length) list.querySelector(".menuitem")?.classList.add("focus");
  setSoftkeys("选择", "", "返回");
}

function runMenu(item: KaiOSMenuItem): void {
  closeMenu();
  item.action();
}

export function isAlertOpen(): boolean {
  const alert = document.getElementById("kaios-alert");
  return Boolean(alert && !alert.hidden);
}

export function closeAlert(accepted = false): boolean {
  const alert = document.getElementById("kaios-alert");
  if (!alert || alert.hidden) return false;
  alert.hidden = true;
  const ok = alertOk, cancel = alertCancel;
  alertOk = undefined;
  alertCancel = undefined;
  (accepted ? ok : cancel)?.();
  return true;
}

export function showAlert(title: string, text: string, onOk?: () => void, onCancel?: () => void): void {
  const alert = document.getElementById("kaios-alert");
  const titleEl = document.getElementById("kaios-alert-title");
  const textEl = document.getElementById("kaios-alert-text");
  if (!alert || !titleEl || !textEl) {
    if (typeof window.confirm === "function" && window.confirm(`${title}\n${text}`)) onOk?.();
    else onCancel?.();
    return;
  }
  titleEl.textContent = title;
  textEl.textContent = text;
  alertOk = onOk;
  alertCancel = onCancel;
  alert.hidden = false;
  setSoftkeys("确定", "", onCancel ? "取消" : "关闭");
}

export function openDialog(dialog: HTMLDialogElement): void {
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

export function closeDialog(dialog: HTMLDialogElement): void {
  if (typeof dialog.close === "function" && dialog.open) dialog.close();
  else dialog.removeAttribute("open");
}

export function dialogIsOpen(dialog: HTMLDialogElement): boolean {
  return Boolean(dialog.open) || dialog.hasAttribute("open");
}

export function classifyKaiOSKey(ev: KeyboardEvent): KaiOSKey | undefined {
  const key = ev.key;
  if (key === "ArrowUp" || key === "Up") return "up";
  if (key === "ArrowDown" || key === "Down") return "down";
  if (key === "ArrowLeft" || key === "Left") return "left";
  if (key === "ArrowRight" || key === "Right") return "right";
  if (key === "Enter") return "enter";
  if (key === "SoftLeft" || key === "F1" || ev.keyCode === 403) return "softLeft";
  if (key === "SoftRight" || key === "F2" || ev.keyCode === 404) return "softRight";
  if (key === "Backspace" || key === "EndCall" || key === "Escape") return "back";
  return undefined;
}

function onGlobalKey(ev: KeyboardEvent): void {
  const kind = classifyKaiOSKey(ev);
  if (!kind) return;
  if (ev.target instanceof HTMLInputElement && ev.target.type === "file" && kind === "enter") return;
  if (isTextInput(ev.target) && kind !== "back" && kind !== "softRight" && kind !== "softLeft" && kind !== "enter") return;
  if (isAlertOpen()) {
    if (kind === "softLeft" || kind === "enter") { ev.preventDefault(); ev.stopPropagation(); closeAlert(true); }
    else if (kind === "softRight" || kind === "back") { ev.preventDefault(); ev.stopPropagation(); closeAlert(false); }
    return;
  }
  if (isMenuOpen()) {
    const list = document.getElementById("kaios-menu-items");
    if (kind === "up" && list) { ev.preventDefault(); ev.stopPropagation(); moveFocus(list, ".menuitem", -1); return; }
    if (kind === "down" && list) { ev.preventDefault(); ev.stopPropagation(); moveFocus(list, ".menuitem", 1); return; }
    if (kind === "enter" || kind === "softLeft") {
      const index = list ? Array.from(list.querySelectorAll(".menuitem")).findIndex(item => item.classList.contains("focus")) : -1;
      const item = menuItems[index] ?? menuItems[0];
      if (item) runMenu(item);
      ev.preventDefault(); ev.stopPropagation();
      return;
    }
    if (kind === "softRight" || kind === "back") { ev.preventDefault(); ev.stopPropagation(); closeMenu(); return; }
    return;
  }
  const handled = pageKeys?.[kind]?.();
  if (handled) { ev.preventDefault(); ev.stopPropagation(); }
}

export function cycleSelect(select: HTMLSelectElement, delta: number): void {
  const count = select.options.length;
  if (!count) return;
  select.selectedIndex = (select.selectedIndex + delta + count) % count;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

export function nudgeRange(input: HTMLInputElement, delta: number): void {
  const step = Number(input.step) || 1;
  const min = Number(input.min);
  const max = Number(input.max);
  const next = Number(input.value) + delta * step * 5;
  input.value = String(Math.min(Number.isFinite(max) ? max : next, Math.max(Number.isFinite(min) ? min : next, next)));
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

export function activateKaiOSControl(el: HTMLElement): void {
  if (el instanceof HTMLButtonElement) { el.click(); return; }
  if (el instanceof HTMLSelectElement) { cycleSelect(el, 1); return; }
  const field = el instanceof HTMLInputElement ? el : el.querySelector("input, select");
  if (field instanceof HTMLSelectElement) { cycleSelect(field, 1); return; }
  if (field instanceof HTMLInputElement && field.type === "checkbox") {
    field.checked = !field.checked;
    field.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  if (field instanceof HTMLInputElement && field.type === "range") { nudgeRange(field, 1); return; }
  el.click();
}

export function adjustKaiOSControl(el: HTMLElement, delta: number): void {
  const field = el instanceof HTMLSelectElement || el instanceof HTMLInputElement ? el : el.querySelector("input, select");
  if (field instanceof HTMLSelectElement) { cycleSelect(field, delta); return; }
  if (field instanceof HTMLInputElement && field.type === "range") { nudgeRange(field, delta); return; }
  if (field instanceof HTMLInputElement && field.type === "checkbox") {
    field.checked = delta > 0;
    field.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

export function applyKaiOS(options?: { fullscreen?: boolean }): boolean {
  if (!isKaiOS() || typeof document === "undefined") return false;
  document.documentElement.classList.add("kaios");
  try { document.documentElement.dataset.theme = "dark"; } catch { /* theme is optional */ }
  const theme = document.querySelector('meta[name="theme-color"]');
  if (theme) theme.setAttribute("content", "#0b1220");
  const softkeys = document.getElementById("kaios-softkeys");
  if (options?.fullscreen) {
    document.documentElement.classList.add("kaios-player");
    if (softkeys) softkeys.hidden = true;
  } else if (softkeys) {
    softkeys.hidden = false;
  }
  if (!listening) {
    listening = true;
    window.addEventListener("keydown", onGlobalKey, true);
  }
  return true;
}
