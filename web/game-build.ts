import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Plugin } from "vite";
import { publishGames } from "../tools/static-files.ts";
import classics from "../config/classic-games.json";

export function gameBuild(directory: string | undefined): Plugin {
  let output = "";
  return {
    name: "static-mrp-library", apply: "build",
    configResolved(config) { output = resolve(config.root, config.build.outDir, "games"); },
    async closeBundle() {
      if (!directory) return;
      if (classics.games.length !== 100) throw new Error("精选游戏清单必须恰好包含 100 个游戏。");
      const { games, copied, skipped, removed } = await publishGames(directory, output, classics.games);
      await mkdir(output, { recursive: true });
      await writeFile(join(output, "index.json"), JSON.stringify(games));
      console.log(`MRP 精选游戏库：${games.length} 个，复制 ${copied}，未变化跳过 ${skipped}，清理旧文件 ${removed}。`);
    },
  };
}
