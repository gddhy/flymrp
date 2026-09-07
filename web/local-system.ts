import type { Plugin, ViteDevServer } from "vite";
import { loadGameResourceFiles, loadLocalSystemFiles, systemFileHashes } from "../tools/local-system-files.ts";

/** Local directory resources are served only by their enumerated content hashes. */
export function localSystem(directory: string | undefined, resourceMode = false): Plugin {
  const endpoint = resourceMode ? "/__resources" : "/__system";
  const register = (server: Pick<ViteDevServer, "middlewares">) => {
    const blobs = new Map<string, Uint8Array>();
    server.middlewares.use(async (req, res, next) => {
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      if (path !== endpoint && !path.startsWith(endpoint + "/")) return next();
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (req.method !== "GET") { res.statusCode = 405; res.end(); return; }
      try {
        if (path === endpoint) {
          const game = new URL(req.url ?? "/", "http://localhost").searchParams.get("game") ?? "";
          const files = resourceMode ? await loadGameResourceFiles(directory, game) : await loadLocalSystemFiles(directory), hashes = systemFileHashes(files);
          blobs.clear();
          const manifest = Object.entries(files).map(([name, bytes]) => {
            const sha256 = hashes[name]; blobs.set(sha256, bytes);
            return { name, sha256, size: bytes.length };
          });
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify(manifest)); return;
        }
        const hash = path.slice(endpoint.length + 1), bytes = /^[a-f0-9]{64}$/.test(hash) ? blobs.get(hash) : null;
        if (!bytes) { res.statusCode = 404; res.end(); return; }
        res.setHeader("Content-Type", "application/octet-stream"); res.end(bytes);
      } catch { res.statusCode = 500; res.end("Cannot read local handset resources"); }
    });
  };
  return { name: resourceMode ? "local-game-resources" : "local-handset-resources", configureServer: register, configurePreviewServer: register };
}
