import './kaios-polyfill.ts';
import { saveSdFile, sdPath } from './sd-card.ts';
import { assetUrl, gameTitle, readLibrary, type Game } from './library.ts';
import { applyKaiOS, focusedItem, moveFocus, openMenu, setKaiOSPageKeys, setSoftkeys, showAlert } from './kaios.ts';

const search = document.querySelector<HTMLInputElement>('#search')!;
const container = document.querySelector<HTMLElement>('#games')!;
const count = document.querySelector<HTMLElement>('#library-count')!;
const categories = document.querySelector<HTMLElement>('#categories')!;
let games: Game[] = [], category = '全部', focusedName = '';
const kaios = applyKaiOS();

function launchGame(gameName: string): void {
  const url = new URL(assetUrl('main.html'));
  url.searchParams.set('game', gameName);
  location.assign(url.href);
}

function launchFocused(): boolean {
  const card = focusedItem(container, '.game-card');
  const name = card?.getAttribute('data-name');
  if (name) launchGame(name);
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
  setSoftkeys('菜单', cards.length ? '启动' : '', '退出');
}

function render(): void {
  const term = search.value.trim().toLowerCase();
  const matches = games.filter(game => (category === '全部' || game.category === category) && `${gameTitle(game)} ${game.category} ${game.name}`.toLowerCase().includes(term));
  count.textContent = `${matches.length} 款游戏`;
  container.replaceChildren(...matches.map(game => {
    const card = document.createElement('a'); card.className = 'game-card listitem';
    card.setAttribute('data-name', game.name);
    const url = new URL(assetUrl('main.html')); url.searchParams.set('game', game.name); card.href = url.href;
    const art = document.createElement('span'); art.className = 'game-art'; art.dataset.tone = String(game.id % 6); art.setAttribute('aria-hidden', 'true'); art.textContent = gameTitle(game).slice(0, 2);
    const info = document.createElement('span'); info.className = 'game-info';
    const title = document.createElement('strong'); title.textContent = gameTitle(game);
    const detail = document.createElement('span'); detail.textContent = game.category ?? '经典游戏';
    const arrow = document.createElement('span'); arrow.className = 'play-arrow'; arrow.textContent = '↗'; arrow.setAttribute('aria-hidden', 'true');
    info.append(title, detail); card.append(art, info, arrow); card.setAttribute('aria-label', `开始游戏：${gameTitle(game)}`);
    return card;
  }));
  document.querySelector<HTMLElement>('#empty')!.hidden = !!matches.length;
  refreshListFocus();
}

async function openLocalFile(file: File): Promise<void> {
  const path = sdPath('games', file.name);
  await saveSdFile({ path, bytes: new Uint8Array(await file.arrayBuffer()), modified: file.lastModified });
  const url = new URL(assetUrl('main.html')); url.searchParams.set('local', path);
  location.assign(url.href);
}

function pickLocalMrp(): void {
  const MozActivity = (window as unknown as { MozActivity?: new (opts: unknown) => { onsuccess: ((this: { result: { blob?: Blob; name?: string } }) => void) | null; onerror: (() => void) | null } }).MozActivity;
  if (typeof MozActivity === 'function') {
    const pick = new MozActivity({ name: 'pick', data: { type: ['application/octet-stream', '*/*'] } });
    pick.onsuccess = function () {
      const blob = this.result.blob;
      if (!blob) return;
      const file = blob instanceof File ? blob : new File([blob], this.result.name || 'game.mrp');
      void openLocalFile(file).catch(error => { count.textContent = `无法打开本地游戏：${error instanceof Error ? error.message : error}`; });
    };
    pick.onerror = () => showAlert('提示', '没有选择文件。');
    return;
  }
  if (!/KAIOS/i.test(navigator.userAgent) && !('b2g' in navigator)) {
    document.querySelector<HTMLInputElement>('#local-file')?.click();
    return;
  }
  showAlert('提示', '这是按键机，请用方向键选择内置游戏。');
}

function exitApp(): void {
  showAlert('退出', '确定退出 flymrp？', () => { window.close(); }, () => { setSoftkeys('菜单', container.querySelector('.game-card') ? '启动' : '', '退出'); });
}

function openCatalogMenu(): boolean {
  openMenu([
    { label: '启动游戏', action: () => { launchFocused(); } },
    { label: '打开 MRP', action: pickLocalMrp },
    { label: '刷新列表', action: () => { void load(); } },
    { label: '关于', action: () => showAlert('关于', 'flymrp · KaiOS 2.x\n方向键选择，确认键启动。\n左右软键在游戏里给游戏使用。\n返回键回到列表。') },
    { label: '退出', action: exitApp },
  ]);
  return true;
}

async function load(): Promise<void> {
  const button = document.querySelector<HTMLButtonElement>('#refresh-library')!; button.disabled = true;
  try {
    games = await readLibrary(); document.querySelector('#total-count')!.textContent = String(games.length);
    const names = ['全部', ...new Set(games.map(game => game.category ?? '经典游戏'))];
    if (!names.includes(category)) category = '全部';
    categories.replaceChildren(...names.map(name => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = name; button.setAttribute('aria-pressed', String(name === category));
      button.addEventListener('click', () => { category = name; for (const item of categories.querySelectorAll('button')) item.setAttribute('aria-pressed', String(item === button)); render(); }); return button;
    })); render();
  } catch (error) { count.textContent = String(error instanceof Error ? error.message : error); }
  finally { button.disabled = false; }
}
search.addEventListener('input', render);
document.querySelector('#refresh-library')!.addEventListener('click', () => { void load(); });
document.querySelector<HTMLInputElement>('#local-file')!.addEventListener('change', async event => {
  const input = event.currentTarget as HTMLInputElement, file = input.files?.[0]; input.value = ''; if (!file) return;
  input.disabled = true;
  try { await openLocalFile(file); }
  catch (error) { count.textContent = `无法打开本地游戏：${error instanceof Error ? error.message : error}`; }
  finally { input.disabled = false; }
});
function theme(value: string): void { document.documentElement.dataset.theme = value; try { localStorage.setItem('flymrp.theme', value); } catch {} }
try { theme(localStorage.getItem('flymrp.theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')); } catch {}
document.querySelector('#theme')!.addEventListener('click', () => theme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
if (kaios) {
  theme('dark');
  setKaiOSPageKeys({
    up: () => { const current = moveFocus(container, '.game-card', -1); focusedName = current?.getAttribute('data-name') ?? focusedName; return true; },
    down: () => { const current = moveFocus(container, '.game-card', 1); focusedName = current?.getAttribute('data-name') ?? focusedName; return true; },
    enter: launchFocused,
    softLeft: openCatalogMenu,
    softRight: () => { exitApp(); return true; },
    back: () => { exitApp(); return true; },
  });
  setSoftkeys('菜单', '启动', '退出');
}
void load();
