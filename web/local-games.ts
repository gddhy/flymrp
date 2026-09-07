import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Plugin } from "vite";

/** Opt-in, dev-only library. Only enumerated regular MRP files are addressable. */
export function localGames(directory: string | undefined): Plugin {
  return {
    name: "local-mrp-library",
    configureServer(server) {
      let files: string[] | null = null;
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
          files ??= await scan(directory);
          if (pathname === "/__games") {
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify(files.map((p, id) => ({ id, name: relative(directory, p) }))));
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
