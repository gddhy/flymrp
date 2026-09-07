import { isGameResource } from "../tools/local-system-files.ts";
import { readdir, mkdir, readFile, copyFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import type { Plugin } from "vite";

/** Build a static download tree with a lightweight per-game index. */
export function resourceBuild(directory: string | undefined): Plugin {
  let output = "";
  return {
    name: "game-resource-build", apply: "build",
    configResolved(config) { output = resolve(config.root, config.build.outDir, "mythroad_res"); },
    async closeBundle() {
      if (!directory) return;
      const groups: Record<string, { name: string; sha256: string; size: number }[]> = {};
      async function copy(dir: string): Promise<void> {
        let entries;
        try { entries = await readdir(dir, { withFileTypes: true }); }
        catch (e) { if (dir === directory && (e as NodeJS.ErrnoException).code === "ENOENT") return; throw e; }
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
          if (entry.name.startsWith(".")) continue;
          const source = join(dir, entry.name), name = relative(directory!, source).replace(/\\/g, "/");
          if (entry.isDirectory()) await copy(source);
          else if (entry.isFile()) {
            const bytes = await readFile(source), sha256 = createHash("sha256").update(bytes).digest("hex");
            const target = join(output, name); await mkdir(dirname(target), { recursive: true }); await copyFile(source, target);
            if (!isGameResource(name)) continue;
            const group = name.includes("/") ? name.split("/")[0].toLowerCase() : "";
            (groups[group] ??= []).push({ name, sha256, size: bytes.length });
          }
        }
      }
      await copy(directory);
      await mkdir(output, { recursive: true });
      await writeFile(join(output, "index.json"), JSON.stringify({ groups }));
    },
  };
}
