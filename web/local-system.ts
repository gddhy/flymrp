import type { Plugin, ViteDevServer } from "vite";
import { lstat, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { isGameResource, loadGameResourceFiles, loadLocalSystemFiles, systemFileHashes } from "../tools/local-system-files.ts";
import { isSafeAssetPath } from "./remote-files.ts";

async function readSafeLocalFile(root: string, name: string, resourceMode: boolean): Promise<Uint8Array | null> {
  if (!isSafeAssetPath(name) || (resourceMode && !isGameResource(name))) return null;
  const target = resolve(root, name), rel = relative(resolve(root), target);
  if (!rel || rel.startsWith("..") || rel.split(sep).includes("..")) return null;
  const parts = rel.split(sep);
  let cursor = resolve(root);
  for (let i = 0; i < parts.length; i++) {
    cursor = join(cursor, parts[i]!);
    let info;
    try { info = await lstat(cursor); } catch { return null; }
    if (info.isSymbolicLink() || (i < parts.length - 1 ? !info.isDirectory() : !info.isFile())) return null;
  }
  return new Uint8Array(await readFile(cursor));
}

/** Manifest stays hash-addressed; `/file/` serves one relative path for on-demand reads. */
export function localSystem(directory: string | undefined, resourceMode = false): Plugin {
  const endpoint = resourceMode ? "/__resources" : "/__system";
  const register = (server: Pick<ViteDevServer, "middlewares">) => {
    const blobs = new Map<string, Uint8Array>();
    server.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url ?? "/", "http://localhost"), path = url.pathname;
      if (path !== endpoint && !path.startsWith(endpoint + "/")) return next();
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (req.method !== "GET") { res.statusCode = 405; res.end(); return; }
      try {
        if (path === endpoint) {
          const game = url.searchParams.get("game") ?? "";
          const files = resourceMode ? await loadGameResourceFiles(directory, game) : await loadLocalSystemFiles(directory), hashes = systemFileHashes(files);
          blobs.clear();
          const manifest = Object.entries(files).map(([name, bytes]) => {
            const sha256 = hashes[name]; blobs.set(sha256, bytes);
            return { name, sha256, size: bytes.length };
          });
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify(manifest)); return;
        }
        const filePrefix = endpoint + "/file/";
        if (path.startsWith(filePrefix)) {
          let name = "";
          try { name = decodeURIComponent(path.slice(filePrefix.length)); } catch { res.statusCode = 404; res.end(); return; }
          if (resourceMode) {
            const stem = (url.searchParams.get("game") ?? "").replace(/\.mrp$/i, "").toLowerCase();
            if (!stem || name.split("/")[0]?.toLowerCase() !== stem) { res.statusCode = 404; res.end(); return; }
          }
          const bytes = directory ? await readSafeLocalFile(directory, name, resourceMode) : null;
          if (!bytes) { res.statusCode = 404; res.end(); return; }
          res.setHeader("Content-Type", "application/octet-stream"); res.end(bytes); return;
        }
        const hash = path.slice(endpoint.length + 1), bytes = /^[a-f0-9]{64}$/.test(hash) ? blobs.get(hash) : null;
        if (!bytes) { res.statusCode = 404; res.end(); return; }
        res.setHeader("Content-Type", "application/octet-stream"); res.end(bytes);
      } catch { res.statusCode = 500; res.end("Cannot read local handset resources"); }
    });
  };
  return { name: resourceMode ? "local-game-resources" : "local-handset-resources", configureServer: register, configurePreviewServer: register };
}
