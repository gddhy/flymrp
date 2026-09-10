import { createReadStream } from "node:fs";
import { copyFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, relative } from "node:path";

export async function fileSha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

/** Compare contents, not timestamps: same-size updates with preserved mtime count. */
export async function copyStaticFile(source: string, destination: string): Promise<{ sha256: string; size: number; copied: boolean }> {
  const sourceStat = await stat(source), sha256 = await fileSha256(source);
  try {
    const targetStat = await stat(destination);
    if (targetStat.isFile() && targetStat.size === sourceStat.size && await fileSha256(destination) === sha256)
      return { sha256, size: sourceStat.size, copied: false };
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try { await copyFile(source, temporary); await rename(temporary, destination); }
  finally { await rm(temporary, { force: true }); }
  return { sha256, size: sourceStat.size, copied: true };
}

/** Preserve relative paths, including duplicate basenames; never follow symlinks. */
export async function listMrpFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && /\.mrp$/i.test(entry.name)) result.push(relative(directory, path).replace(/\\/g, "/"));
    }
  }
  await walk(directory);
  return result.sort();
}

export type SelectedGame = { path: string; title: string; category: string; sha256: string };
export type PublishedGame = { id: number; name: string; sha256: string; size: number; title?: string; category?: string };
export async function publishGames(directory: string, output: string, selection?: readonly SelectedGame[]): Promise<{ games: PublishedGame[]; copied: number; skipped: number; removed: number }> {
  const available = await listMrpFiles(directory);
  // Validate the entire selection before changing the previously published library.
  if (selection) {
    const seen = new Set<string>(), regularFiles = new Set(available);
    for (const game of selection) {
      if (seen.has(game.path)) throw new Error(`重复的精选游戏路径：${game.path}`);
      seen.add(game.path);
      if (!regularFiles.has(game.path)) throw new Error(`缺少精选游戏：${game.path}`);
      if (await fileSha256(join(directory, game.path)) !== game.sha256) throw new Error(`精选游戏内容与清单不一致：${game.path}`);
    }
  }
  const names = selection ? selection.map(game => game.path) : available;
  const games: PublishedGame[] = new Array(names.length);
  let cursor = 0, copied = 0, skipped = 0;
  // Limit open files and memory for a multi-gigabyte collection.
  await Promise.all(Array.from({ length: Math.min(4, names.length) }, async () => {
    while (cursor < names.length) {
      const id = cursor++, name = names[id];
      const file = await copyStaticFile(join(directory, name), join(output, name));
      if (file.copied) copied++; else skipped++;
      games[id] = { id, name, size: file.size, sha256: file.sha256,
        ...(selection ? { title: selection[id].title, category: selection[id].category } : {}) };
    }
  }));
  // games/ is generated output. Remove old full-library files so incremental
  // builds cannot accidentally deploy thousands of unlisted games to Pages.
  let removed = 0;
  if (selection) {
    const keep = new Set([...names, "index.json"]);
    async function prune(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          await prune(path);
          if (!(await readdir(path)).length) await rm(path, { recursive: true });
        } else if (!keep.has(relative(output, path).replace(/\\/g, "/"))) {
          await rm(path); removed++;
        }
      }
    }
    await mkdir(output, { recursive: true });
    await prune(output);
  }
  return { games, copied, skipped, removed };
}
