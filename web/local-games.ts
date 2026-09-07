import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Plugin } from "vite";
import classics from "../config/classic-games.json";

/** Opt-in, dev-only library. Only enumerated regular MRP files are addressable. */
export function localGames(directory: string | undefined): Plugin {
  return {
    name: "local-mrp-library",
    configureServer(server) {
      const files: string[] = [];
      const ids = new Map<string, number>();
      async function scan(dir: string): Promise<string[]> {
        const entries = await readdir(dir, { withFileTypes: true });
        const groups = await Promise.all(entries.map(e => e.isDirectory() ? scan(join(dir, e.name)) :
          e.isFile() && /\.mrp$/i.test(e.name) ? [join(dir, e.name)] : []));
        return groups.flat().sort();
      }
      server.middlewares.use(async (req, res, next) => {
        const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
        if (pathname !== "/__games" && !pathname.startsWith("/__games/")) return next();
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        if (req.method !== "GET") { res.statusCode = 405; res.end(); return; }
        try {
          if (!directory) {
            res.setHeader("Content-Type", "application/json");
            res.end("[]"); return;
          }
          if (pathname === "/__games") {
            const available = new Set(await scan(directory));
            const current = classics.games.filter(game => available.has(join(directory, game.path)));
            for (const game of current) {
              const file = join(directory, game.path);
              if (!ids.has(file)) { ids.set(file, files.length); files.push(file); }
            }
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify(current.map(game => ({ id: ids.get(join(directory, game.path)), name: game.path, title: game.title, category: game.category }))));
            return;
          }
          const id = pathname.slice("/__games/".length);
          if (!/^\d+$/.test(id) || !files[Number(id)]) { res.statusCode = 404; res.end(); return; }
          res.setHeader("Content-Type", "application/octet-stream");
          res.end(await readFile(files[Number(id)]));
        } catch {
          res.statusCode = 500;
          res.end("Cannot read local game library");
        }
      });
    },
  };
}
