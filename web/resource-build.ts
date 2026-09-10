import { isGameResource } from "../tools/local-system-files.ts";
import { readdir, mkdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { copyStaticFile } from "../tools/static-files.ts";
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
            const { sha256, size } = await copyStaticFile(source, join(output, name));
            if (!isGameResource(name)) continue;
            const group = name.includes("/") ? name.split("/")[0].toLowerCase() : "";
            (groups[group] ??= []).push({ name, sha256, size });
          }
        }
      }
      await copy(directory);
      await mkdir(join(output, "groups"), { recursive: true });
      await writeFile(join(output, "index.json"), JSON.stringify({ groups }));
      for (const [group, files] of Object.entries(groups)) {
        if (!/^[a-z0-9_.-]+$/.test(group)) continue;
        await writeFile(join(output, "groups", `${group}.json`), JSON.stringify(files.map(file => file.name)));
      }
    },
  };
}
