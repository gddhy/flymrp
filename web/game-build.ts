import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Plugin } from "vite";
import { publishGames } from "../tools/static-files.ts";

export function gameBuild(directory: string | undefined): Plugin {
  let output = "";
  return {
    name: "static-mrp-library", apply: "build",
    configResolved(config) { output = resolve(config.root, config.build.outDir, "games"); },
    async closeBundle() {
      if (!directory) return;
      const { games, copied, skipped } = await publishGames(directory, output);
      await mkdir(output, { recursive: true });
      await writeFile(join(output, "index.json"), JSON.stringify(games));
      console.log(`MRP 游戏库：${games.length} 个，复制 ${copied}，未变化跳过 ${skipped}。`);
    },
  };
}
