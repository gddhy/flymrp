import { assetUrl, gameTitle, readLibrary, type Game } from './library.ts';
const search = document.querySelector<HTMLInputElement>('#search')!;
const container = document.querySelector<HTMLElement>('#games')!;
const count = document.querySelector<HTMLElement>('#library-count')!;
const categories = document.querySelector<HTMLElement>('#categories')!;
const dialog = document.querySelector<HTMLDialogElement>('#player-dialog')!;
const frame = document.querySelector<HTMLIFrameElement>('#player-frame')!;
let games: Game[] = [], category = '全部', localFile: File | null = null;
function openPlayer(game?: Game, file?: File): void {
  localFile = file ?? null;
  const url = new URL(assetUrl('main.html'));
  if (game) url.searchParams.set('game', game.name);
  frame.src = url.href;
  dialog.showModal();
  document.body.style.overflow = 'hidden';
}
function closePlayer(): void {
  frame.removeAttribute('src'); localFile = null; dialog.close(); document.body.style.overflow = '';
}
dialog.addEventListener('cancel', event => { event.preventDefault(); closePlayer(); });
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
  if (event.data?.type === 'flymrp:close') closePlayer();
  if (event.data?.type === 'flymrp:ready' && localFile) {
    frame.contentWindow?.postMessage({ type: 'flymrp:file', file: localFile }, location.origin);
    localFile = null;
  }
});
function render(): void {
  const term = search.value.trim().toLowerCase();
  const matches = games.filter(game => (category === '全部' || game.category === category) && `${gameTitle(game)} ${game.category} ${game.name}`.toLowerCase().includes(term));
  count.textContent = `${matches.length} 款游戏`;
  container.replaceChildren(...matches.map((game, index) => {
    const card = document.createElement('button'); card.className = 'game-card'; card.type = 'button';
    const art = document.createElement('span'); art.className = 'game-art'; art.dataset.tone = String(game.id % 6); art.setAttribute('aria-hidden', 'true'); art.textContent = gameTitle(game).slice(0, 2);
    const info = document.createElement('span'); info.className = 'game-info';
    const title = document.createElement('strong'); title.textContent = gameTitle(game);
    const detail = document.createElement('span'); detail.textContent = game.category ?? '经典游戏';
    const arrow = document.createElement('span'); arrow.className = 'play-arrow'; arrow.textContent = '↗'; arrow.setAttribute('aria-hidden', 'true');
    info.append(title, detail); card.append(art, info, arrow); card.setAttribute('aria-label', `开始游戏：${gameTitle(game)}`);
    card.addEventListener('click', () => openPlayer(game)); return card;
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
document.querySelector<HTMLInputElement>('#local-file')!.addEventListener('change', event => {
  const input = event.currentTarget as HTMLInputElement, file = input.files?.[0]; input.value = ''; if (file) openPlayer(undefined, file);
});
function theme(value: string): void { document.documentElement.dataset.theme = value; try { localStorage.setItem('flymrp.theme', value); } catch {} }
try { theme(localStorage.getItem('flymrp.theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')); } catch {}
document.querySelector('#theme')!.addEventListener('click', () => theme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
void load();
