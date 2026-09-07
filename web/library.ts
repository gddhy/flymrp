export type Game = { id: number; name: string; sha256?: string; title?: string; category?: string; size?: number };
export const assetUrl = (path: string): string => new URL(path, document.baseURI).href;
export async function readLibrary(): Promise<Game[]> {
  const response = await fetch(import.meta.env.PROD ? assetUrl('games/index.json') : '/__games', { cache: 'no-cache' });
  if (!response.ok) throw new Error('无法读取精选游戏库，请刷新重试。');
  return response.json();
}
export async function readGame(game: Game): Promise<ArrayBuffer> {
  const response = await fetch(import.meta.env.PROD
    ? assetUrl(`games/${game.name.split('/').map(encodeURIComponent).join('/')}${game.sha256 ? `?v=${encodeURIComponent(game.sha256)}` : ''}`)
    : `/__games/${game.id}`);
  if (!response.ok) throw new Error('无法读取游戏文件。');
  return response.arrayBuffer();
}
export const gameTitle = (game: Game): string => game.title ?? game.name.split('/').at(-1)!.replace(/\.mrp$/i, '');
