import './kaios-polyfill.ts';
import { fileBaseName, listSdFiles, readBlobBytes, removeSdFile, saveSdFile, sdPath } from './sd-card.ts';
import { gameTitle, installedGamesFromSd, isMrpFilename, playerHref, readLibrary, type Game } from './library.ts';
import { applyKaiOS, focusedItem, moveFocus, openMenu, setKaiOSPageKeys, setSoftkeys, showAlert } from './kaios.ts';
import { clearGamePrefs, gameStem, readGamePref, readPref, writePref } from './player-options.ts';

const search = document.querySelector<HTMLInputElement>('#search')!;
const container = document.querySelector<HTMLElement>('#games')!;
const count = document.querySelector<HTMLElement>('#library-count')!;
const categories = document.querySelector<HTMLElement>('#categories')!;
const localFile = document.querySelector<HTMLInputElement>('#local-file')!;
const configFile = document.querySelector<HTMLInputElement>('#config-file')!;
const empty = document.querySelector<HTMLElement>('#empty')!;
const fab = document.querySelector<HTMLButtonElement>('#fab')!;
const overlay = document.querySelector<HTMLElement>('#actionSheetOverlay')!;
const sheet = document.querySelector<HTMLElement>('#gameSettingsSheet')!;
const detailEmpty = document.querySelector<HTMLElement>('#detailEmpty')!;
const detailContent = document.querySelector<HTMLElement>('#detailContent')!;
const asTitle = document.querySelector<HTMLElement>('#asTitle')!;
const asDelete = document.querySelector<HTMLButtonElement>('#asDelete')!;
const detailDelete = document.querySelector<HTMLButtonElement>('#detailDelete')!;

let games: Game[] = [];
let category = '全部';
let focusedName = '';
let selected: Game | undefined;
let sheetGame: Game | undefined;
const kaios = applyKaiOS();
const prefIds = ['resolution', 'zoom', 'midi-player', 'rotation', 'speed', 'keypad-side', 'show-fps'] as const;
const gamePrefMap = [
  ['resolution', 'dsResolution', 'gsResolution'],
  ['zoom', 'dsZoom', 'gsZoom'],
  ['midi-player', 'dsMidi', 'gsMidi'],
  ['rotation', 'dsRotation', 'gsRotation'],
  ['speed', 'dsSpeed', 'gsSpeed'],
  ['keypad-side', 'dsKeypad', 'gsKeypad'],
] as const;

function isDesktop(): boolean {
  return window.matchMedia('(min-width: 768px)').matches;
}

function launchGame(game: Game): void {
  location.assign(playerHref(game));
}

function formatSize(size?: number): string {
  if (!size) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function gameMeta(game: Game): string {
  const parts = [game.local ? '我的游戏' : (game.category ?? '经典游戏')];
  const size = formatSize(game.size);
  if (size) parts.push(size);
  return parts.join(' · ');
}

function artTone(game: Game): string {
  return String(game.id % 6);
}

function artText(game: Game): string {
  return gameTitle(game).slice(0, 2);
}

function focusedGame(): Game | undefined {
  const name = focusedItem(container, '.game-card')?.getAttribute('data-name');
  if (!name) return undefined;
  return games.find(game => game.name === name);
}

function launchFocused(): boolean {
  const game = focusedGame();
  if (game) launchGame(game);
  return true;
}

function refreshListFocus(): void {
  if (!kaios) return;
  const cards = Array.from(container.querySelectorAll<HTMLElement>('.game-card'));
  let current = cards.find(card => card.getAttribute('data-name') === focusedName) ?? cards[0];
  for (const card of cards) card.classList.remove('focus');
  if (current) {
    current.classList.add('focus');
    focusedName = current.getAttribute('data-name') ?? '';
    if (current.scrollIntoView) current.scrollIntoView(false);
  }
  setSoftkeys('菜单', cards.length ? '启动' : '安装', '退出');
}

function fillPrefs(prefix: 'ds' | 'gs', game: Game): void {
  for (const [name, ds, gs] of gamePrefMap) {
    const id = prefix === 'ds' ? ds : gs;
    const select = document.getElementById(id) as HTMLSelectElement | null;
    if (select) select.value = readGamePref(game.name, name);
  }
}

function savePrefsFrom(prefix: 'ds' | 'gs', game: Game): void {
  for (const [name, ds, gs] of gamePrefMap) {
    const id = prefix === 'ds' ? ds : gs;
    const select = document.getElementById(id) as HTMLSelectElement | null;
    if (select) writePref(name, select.value, game.name);
  }
}

function selectGame(game: Game | undefined): void {
  selected = game;
  for (const card of Array.from(container.querySelectorAll('.game'))) {
    card.classList.toggle('selected', !!game && card.getAttribute('data-name') === game.name);
  }
  if (!game) {
    detailEmpty.hidden = false;
    detailContent.hidden = true;
    return;
  }
  detailEmpty.hidden = true;
  detailContent.hidden = false;
  const icon = document.querySelector<HTMLElement>('#detailIcon')!;
  icon.textContent = artText(game);
  icon.dataset.tone = artTone(game);
  document.querySelector('#detailName')!.textContent = gameTitle(game);
  document.querySelector('#detailMeta')!.textContent = gameMeta(game);
  detailDelete.classList.toggle('disabled', !game.local);
  fillPrefs('ds', game);
}

function openActionSheet(game: Game): void {
  sheetGame = game;
  asTitle.textContent = gameTitle(game);
  asDelete.classList.toggle('disabled', !game.local);
  sheet.classList.remove('active');
  overlay.classList.add('show');
}

function closeActionSheet(): void {
  overlay.classList.remove('show');
  sheet.classList.remove('active');
}

function openGameSheet(game: Game): void {
  sheetGame = game;
  document.querySelector('#gsTitle')!.textContent = `${gameTitle(game)} · 独立设置`;
  fillPrefs('gs', game);
  overlay.classList.add('show');
  sheet.classList.add('active');
}

function confirmAction(title: string, message: string, ok: () => void): void {
  if (kaios) {
    showAlert(title, message, ok, () => refreshListFocus());
    return;
  }
  if (window.confirm(message)) ok();
}

async function clearGameData(game: Game): Promise<void> {
  clearGamePrefs(game.name);
  const stem = gameStem(game.name);
  const files = await listSdFiles().catch(() => []);
  for (const file of files) {
    if (file.path === game.name) continue;
    if (file.path.indexOf('games/') === 0) continue;
    if (file.path.indexOf(stem) >= 0) await removeSdFile(file.path);
  }
  count.textContent = `已清除 ${gameTitle(game)} 的独立设置与相关存档`;
}

function deleteGame(game: Game): void {
  if (!game.local) {
    if (kaios) showAlert('提示', '内置游戏不能删除。先安装自己的 MRP，再删除。');
    else window.alert('内置游戏不能删除。');
    return;
  }
  confirmAction('删除', `删除 ${gameTitle(game)}？`, () => {
    void removeSdFile(game.name).then(() => {
      if (focusedName === game.name) focusedName = '';
      if (selected?.name === game.name) selectGame(undefined);
      return load();
    }).catch(failInstall);
  });
}

function render(): void {
  const term = search.value.trim().toLowerCase();
  const matches = games.filter(game => (category === '全部' || game.category === category) && `${gameTitle(game)} ${game.category} ${game.name}`.toLowerCase().includes(term));
  count.textContent = `${matches.length} 款游戏`;
  container.replaceChildren(...matches.map(game => {
    const card = document.createElement('a');
    card.className = 'game game-card listitem';
    card.setAttribute('data-name', game.name);
    if (game.local) card.setAttribute('data-local', '1');
    card.href = playerHref(game);
    const art = document.createElement('span');
    art.className = 'game-art';
    art.dataset.tone = artTone(game);
    art.setAttribute('aria-hidden', 'true');
    art.textContent = artText(game);
    const info = document.createElement('span');
    info.className = 'game-info';
    const title = document.createElement('div');
    title.className = 'game-name';
    title.textContent = gameTitle(game);
    const detail = document.createElement('div');
    detail.className = 'game-meta';
    detail.textContent = gameMeta(game);
    info.append(title, detail);
    card.append(art, info);
    card.setAttribute('aria-label', `开始游戏：${gameTitle(game)}`);
    card.addEventListener('click', event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (kaios) { launchGame(game); return; }
      if (isDesktop()) { selectGame(game); return; }
      openActionSheet(game);
    });
    card.addEventListener('dblclick', event => {
      event.preventDefault();
      if (isDesktop()) launchGame(game);
    });
    return card;
  }));
  empty.hidden = !!matches.length;
  if (selected && !matches.some(game => game.name === selected!.name)) selectGame(undefined);
  else if (selected) selectGame(selected);
  else if (isDesktop() && matches[0]) selectGame(matches[0]);
  refreshListFocus();
}

function failInstall(error: unknown): void {
  const text = error instanceof Error ? error.message : String(error);
  count.textContent = `无法安装本地游戏：${text}`;
  if (kaios) showAlert('安装失败', text, bindCatalogKeys, bindCatalogKeys);
}

async function installMrp(blob: Blob, filename: string): Promise<void> {
  const name = fileBaseName(filename || 'game.mrp');
  if (!isMrpFilename(name)) throw new Error('请选择 .mrp 文件');
  count.textContent = `正在安装 ${name}…`;
  const bytes = await readBlobBytes(blob);
  if (!bytes.length) throw new Error('文件是空的');
  const path = sdPath('games', name);
  await saveSdFile({ path, bytes, modified: (blob as File).lastModified || Date.now() });
  focusedName = path;
  location.assign(playerHref({ id: 0, name: path, local: true }));
}

function pickLocalMrp(): void {
  localFile.value = '';
  localFile.click();
  if (kaios) refreshListFocus();
}

function deleteFocused(): void {
  const game = focusedGame();
  if (!game) return;
  deleteGame(game);
}

function exitApp(): void {
  showAlert('退出', '确定退出 flymrp？', () => { window.close(); }, () => { setSoftkeys('菜单', container.querySelector('.game-card') ? '启动' : '安装', '退出'); });
}

function openCatalogMenu(): boolean {
  openMenu([
    { label: '启动游戏', action: () => { launchFocused(); } },
    { label: '安装 MRP', action: pickLocalMrp },
    { label: '删除游戏', action: deleteFocused },
    { label: '刷新列表', action: () => { void load(); } },
    { label: '关于', action: () => showAlert('关于', 'flymrp · KaiOS 2.x\n菜单「安装 MRP」选择文件，装完立刻开玩。\n已安装的游戏会出现在列表最上面。') },
    { label: '退出', action: exitApp },
  ]);
  return true;
}

function bindCatalogKeys(): void {
  setKaiOSPageKeys({
    up: () => { const current = moveFocus(container, '.game-card', -1); focusedName = current?.getAttribute('data-name') ?? focusedName; return true; },
    down: () => { const current = moveFocus(container, '.game-card', 1); focusedName = current?.getAttribute('data-name') ?? focusedName; return true; },
    enter: () => {
      if (!container.querySelector('.game-card')) { pickLocalMrp(); return true; }
      return launchFocused();
    },
    softLeft: openCatalogMenu,
    softRight: () => { exitApp(); return true; },
    back: () => { exitApp(); return true; },
  });
  refreshListFocus();
}

async function load(): Promise<void> {
  const button = document.querySelector<HTMLButtonElement>('#refresh-library')!;
  button.disabled = true;
  try {
    const bundled = await readLibrary();
    const installed = installedGamesFromSd(await listSdFiles().catch(() => []));
    games = installed.concat(bundled);
    document.querySelector('#total-count')!.textContent = String(games.length);
    const names = ['全部', ...new Set(games.map(game => game.category ?? '经典游戏'))];
    if (!names.includes(category)) category = '全部';
    categories.replaceChildren(...names.map(name => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = name;
      button.setAttribute('aria-pressed', String(name === category));
      button.addEventListener('click', () => {
        category = name;
        for (const item of Array.from(categories.querySelectorAll('button'))) item.setAttribute('aria-pressed', String(item === button));
        render();
      });
      return button;
    }));
    render();
  } catch (error) { count.textContent = String(error instanceof Error ? error.message : error); }
  finally { button.disabled = false; }
}

function applyTheme(mode: string): void {
  const resolved = mode === 'dark' || (mode !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  document.documentElement.dataset.theme = resolved;
  try {
    localStorage.setItem('flymrp.theme-mode', mode);
    localStorage.setItem('flymrp.theme', resolved);
  } catch {}
}

function loadGlobalPrefs(): void {
  const theme = document.querySelector<HTMLSelectElement>('#theme')!;
  let mode = 'auto';
  try { mode = localStorage.getItem('flymrp.theme-mode') ?? (localStorage.getItem('flymrp.theme') ?? 'auto'); } catch {}
  if (mode !== 'light' && mode !== 'dark' && mode !== 'auto') mode = 'auto';
  theme.value = mode;
  applyTheme(mode);
  for (const id of prefIds) {
    const select = document.getElementById(id) as HTMLSelectElement | null;
    if (!select) continue;
    const saved = readPref(id);
    if (saved && Array.from(select.options).some(option => option.value === saved)) select.value = saved;
  }
  const bg = (() => { try { return localStorage.getItem('flymrp.game-bg') ?? ''; } catch { return ''; } })();
  for (const dot of Array.from(document.querySelectorAll<HTMLElement>('#bgColorPicker .color-dot'))) {
    dot.classList.toggle('active', (dot.dataset.color ?? '') === bg);
  }
}

function bindGlobalPrefs(): void {
  document.querySelector<HTMLSelectElement>('#theme')!.addEventListener('change', event => {
    applyTheme((event.currentTarget as HTMLSelectElement).value);
  });
  for (const id of prefIds) {
    document.getElementById(id)?.addEventListener('change', event => {
      writePref(id, (event.currentTarget as HTMLSelectElement).value);
    });
  }
  for (const dot of Array.from(document.querySelectorAll<HTMLElement>('#bgColorPicker .color-dot'))) {
    dot.addEventListener('click', () => {
      const color = dot.dataset.color ?? '';
      try { if (color) localStorage.setItem('flymrp.game-bg', color); else localStorage.removeItem('flymrp.game-bg'); } catch {}
      for (const item of Array.from(document.querySelectorAll('#bgColorPicker .color-dot'))) item.classList.toggle('active', item === dot);
    });
  }
}

function exportConfig(): void {
  const data: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || key.indexOf('flymrp.') !== 0) continue;
      const value = localStorage.getItem(key);
      if (value !== null) data[key] = value;
    }
  } catch {}
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'flymrp-config.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function importConfig(file: File): void {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result)) as Record<string, unknown>;
      for (const [key, value] of Object.entries(data)) {
        if (key.indexOf('flymrp.') !== 0 || typeof value !== 'string') continue;
        localStorage.setItem(key, value);
      }
      loadGlobalPrefs();
      if (selected) fillPrefs('ds', selected);
      count.textContent = '配置已导入';
    } catch (error) {
      count.textContent = `无法导入配置：${error instanceof Error ? error.message : String(error)}`;
    }
  };
  reader.readAsText(file);
}

function switchTab(tabName: string): void {
  document.querySelectorAll('.tab-view').forEach(tab => tab.classList.toggle('active', tab.id === `tab-${tabName}`));
  document.querySelectorAll('.bottom-nav-item, .rail-item').forEach(item => {
    item.classList.toggle('active', item.getAttribute('data-tab') === tabName);
  });
  const titles: Record<string, string> = { games: '游戏列表', settings: '设置' };
  const title = titles[tabName] ?? '游戏列表';
  document.querySelector('#topBarLargeTitle')!.textContent = title;
  document.querySelector('#topBarSmallTitle')!.textContent = title;
  fab.classList.toggle('hidden', tabName !== 'games');
  const hideDetail = tabName !== 'games';
  document.querySelector('#desktopDetail')!.classList.toggle('hidden', hideDetail);
  document.querySelector('#topAppBar')!.classList.toggle('no-detail', hideDetail);
  document.querySelector('.page-layout')!.classList.toggle('no-detail', hideDetail);
  window.scrollTo({ top: 0 });
}

function onPickedFile(input: HTMLInputElement): void {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  input.disabled = true;
  void installMrp(file, file.name).catch(failInstall).then(() => { input.disabled = false; });
}

search.addEventListener('input', render);
document.querySelector('#refresh-library')!.addEventListener('click', () => { void load(); });
document.querySelector('#choose-local')!.addEventListener('click', pickLocalMrp);
document.querySelector('#open-player')!.addEventListener('click', () => { location.assign('./main.html'); });
document.querySelector('#export-config')!.addEventListener('click', exportConfig);
document.querySelector('#import-config')!.addEventListener('click', () => { configFile.value = ''; configFile.click(); });
configFile.addEventListener('change', event => {
  const file = (event.currentTarget as HTMLInputElement).files?.[0];
  if (file) importConfig(file);
});
localFile.addEventListener('change', event => onPickedFile(event.currentTarget as HTMLInputElement));
fab.addEventListener('click', pickLocalMrp);
document.querySelector('#detailRun')!.addEventListener('click', () => { if (selected) launchGame(selected); });
document.querySelector('#detailClearData')!.addEventListener('click', () => {
  if (!selected) return;
  confirmAction('清除数据', `清除 ${gameTitle(selected)} 的独立设置和相关存档？`, () => {
    void clearGameData(selected!).then(() => { if (selected) fillPrefs('ds', selected); });
  });
});
detailDelete.addEventListener('click', () => { if (selected) deleteGame(selected); });
document.querySelector('#dsSave')!.addEventListener('click', () => { if (selected) savePrefsFrom('ds', selected); });
document.querySelector('#dsReset')!.addEventListener('click', () => {
  if (!selected) return;
  clearGamePrefs(selected.name);
  fillPrefs('ds', selected);
});
for (const [, ds] of gamePrefMap) {
  document.getElementById(ds)?.addEventListener('change', () => { if (selected) savePrefsFrom('ds', selected); });
}

document.querySelector('#asRun')!.addEventListener('click', () => { if (sheetGame) launchGame(sheetGame); });
document.querySelector('#asSettings')!.addEventListener('click', () => { if (sheetGame) openGameSheet(sheetGame); });
document.querySelector('#asClearData')!.addEventListener('click', () => {
  if (!sheetGame) return;
  const game = sheetGame;
  closeActionSheet();
  confirmAction('清除数据', `清除 ${gameTitle(game)} 的独立设置和相关存档？`, () => { void clearGameData(game); });
});
asDelete.addEventListener('click', () => {
  if (!sheetGame) return;
  const game = sheetGame;
  closeActionSheet();
  deleteGame(game);
});
document.querySelector('#asCancel')!.addEventListener('click', closeActionSheet);
overlay.addEventListener('click', event => { if (event.target === overlay) closeActionSheet(); });
document.querySelector('#gsSave')!.addEventListener('click', () => {
  if (sheetGame) savePrefsFrom('gs', sheetGame);
  closeActionSheet();
});
document.querySelector('#gsReset')!.addEventListener('click', () => {
  if (!sheetGame) return;
  clearGamePrefs(sheetGame.name);
  fillPrefs('gs', sheetGame);
});

for (const item of Array.from(document.querySelectorAll<HTMLElement>('[data-tab]'))) {
  item.addEventListener('click', () => switchTab(item.getAttribute('data-tab') ?? 'games'));
}

const topBar = document.querySelector('#topAppBar')!;
let scrolled = false;
window.addEventListener('scroll', () => {
  const y = window.pageYOffset;
  if (!scrolled && y > 30) { scrolled = true; topBar.classList.add('scrolled'); }
  else if (scrolled && y < 5) { scrolled = false; topBar.classList.remove('scrolled'); }
}, { passive: true });

loadGlobalPrefs();
bindGlobalPrefs();
const initTab = new URLSearchParams(location.search).get('tab');
if (initTab) switchTab(initTab);
if (kaios) {
  applyTheme('dark');
  bindCatalogKeys();
}
void load();
