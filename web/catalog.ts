import { saveSdFile, sdPath } from './sd-card.ts';
import { assetUrl, gameTitle, readLibrary, type Game } from './library.ts';
const search = document.querySelector<HTMLInputElement>('#search')!;
const container = document.querySelector<HTMLElement>('#games')!;
const count = document.querySelector<HTMLElement>('#library-count')!;
const categories = document.querySelector<HTMLElement>('#categories')!;
let games: Game[] = [], category = '全部';
function render(): void {
  const term = search.value.trim().toLowerCase();
  const matches = games.filter(game => (category === '全部' || game.category === category) && `${gameTitle(game)} ${game.category} ${game.name}`.toLowerCase().includes(term));
  count.textContent = `${matches.length} 款游戏`;
  container.replaceChildren(...matches.map(game => {
    const card = document.createElement('a'); card.className = 'game-card';
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
  try {
    const path = sdPath('games', file.name);
    await saveSdFile({ path, bytes: new Uint8Array(await file.arrayBuffer()), modified: file.lastModified });
    const url = new URL(assetUrl('main.html')); url.searchParams.set('local', path);
    location.assign(url.href);
  } catch (error) { count.textContent = `无法打开本地游戏：${error instanceof Error ? error.message : error}`; }
  finally { input.disabled = false; }
});
function theme(value: string): void { document.documentElement.dataset.theme = value; try { localStorage.setItem('flymrp.theme', value); } catch {} }
try { theme(localStorage.getItem('flymrp.theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')); } catch {}
document.querySelector('#theme')!.addEventListener('click', () => theme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
void load();
