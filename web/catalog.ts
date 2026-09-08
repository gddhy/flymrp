import './kaios-polyfill.ts';
import { fileBaseName, listSdFiles, readBlobBytes, removeSdFile, saveSdFile, sdPath } from './sd-card.ts';
import { gameTitle, installedGamesFromSd, isMrpFilename, playerHref, readLibrary, type Game } from './library.ts';
import { applyKaiOS, focusedItem, moveFocus, openMenu, setKaiOSPageKeys, setSoftkeys, showAlert } from './kaios.ts';

const search = document.querySelector<HTMLInputElement>('#search')!;
const container = document.querySelector<HTMLElement>('#games')!;
const count = document.querySelector<HTMLElement>('#library-count')!;
const categories = document.querySelector<HTMLElement>('#categories')!;
const localFile = document.querySelector<HTMLInputElement>('#local-file')!;
let games: Game[] = [], category = '全部', focusedName = '';
const kaios = applyKaiOS();

function launchGame(game: Game): void {
  location.assign(playerHref(game));
}

function focusedGame(): Game | undefined {
  const name = focusedItem(container, '.game-card')?.getAttribute('data-name');
  if (!name) return undefined;
  for (let i = 0; i < games.length; i++) if (games[i]!.name === name) return games[i];
  return undefined;
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

function render(): void {
  const term = search.value.trim().toLowerCase();
  const matches = games.filter(game => (category === '全部' || game.category === category) && `${gameTitle(game)} ${game.category} ${game.name}`.toLowerCase().includes(term));
  count.textContent = `${matches.length} 款游戏`;
  container.replaceChildren(...matches.map(game => {
    const card = document.createElement('a'); card.className = 'game-card listitem';
    card.setAttribute('data-name', game.name);
    if (game.local) card.setAttribute('data-local', '1');
    card.href = playerHref(game);
    const art = document.createElement('span'); art.className = 'game-art'; art.dataset.tone = String(game.id % 6); art.setAttribute('aria-hidden', 'true'); art.textContent = gameTitle(game).slice(0, 2);
    const info = document.createElement('span'); info.className = 'game-info';
    const title = document.createElement('strong'); title.textContent = gameTitle(game);
    const detail = document.createElement('span'); detail.textContent = game.local ? '我的游戏' : (game.category ?? '经典游戏');
    const arrow = document.createElement('span'); arrow.className = 'play-arrow'; arrow.textContent = '↗'; arrow.setAttribute('aria-hidden', 'true');
    info.append(title, detail); card.append(art, info, arrow); card.setAttribute('aria-label', `开始游戏：${gameTitle(game)}`);
    return card;
  }));
  document.querySelector<HTMLElement>('#empty')!.hidden = !!matches.length;
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
  if (!game || !game.local) {
    showAlert('提示', '内置游戏不能删除。先安装自己的 MRP，再删除。');
    return;
  }
  showAlert('删除', `删除 ${gameTitle(game)}？`, () => {
    void removeSdFile(game.name).then(() => {
      if (focusedName === game.name) focusedName = '';
      return load();
    }).catch(failInstall);
  }, () => refreshListFocus());
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
  const button = document.querySelector<HTMLButtonElement>('#refresh-library')!; button.disabled = true;
  try {
    const bundled = await readLibrary();
    const installed = installedGamesFromSd(await listSdFiles().catch(() => []));
    games = installed.concat(bundled);
    document.querySelector('#total-count')!.textContent = String(games.length);
    const names = ['全部', ...new Set(games.map(game => game.category ?? '经典游戏'))];
    if (!names.includes(category)) category = '全部';
    categories.replaceChildren(...names.map(name => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = name; button.setAttribute('aria-pressed', String(name === category));
      button.addEventListener('click', () => { category = name; for (const item of Array.from(categories.querySelectorAll('button'))) item.setAttribute('aria-pressed', String(item === button)); render(); }); return button;
    })); render();
  } catch (error) { count.textContent = String(error instanceof Error ? error.message : error); }
  finally { button.disabled = false; }
}
search.addEventListener('input', render);
document.querySelector('#refresh-library')!.addEventListener('click', () => { void load(); });
function onPickedFile(input: HTMLInputElement): void {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  input.disabled = true;
  void installMrp(file, file.name).catch(failInstall).then(() => { input.disabled = false; });
}
localFile.addEventListener('change', event => onPickedFile(event.currentTarget as HTMLInputElement));
function theme(value: string): void { document.documentElement.dataset.theme = value; try { localStorage.setItem('flymrp.theme', value); } catch {} }
try { theme(localStorage.getItem('flymrp.theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')); } catch {}
document.querySelector('#theme')!.addEventListener('click', () => theme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
if (kaios) {
  theme('dark');
  bindCatalogKeys();
}
void load();
