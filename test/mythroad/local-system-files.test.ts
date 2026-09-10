import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { ViteDevServer } from "vite";
import { loadGameResourceFiles, loadLocalSystemFiles, systemFileHashes } from "../../tools/local-system-files.ts";
import { localSystem } from "../../web/local-system.ts";
const directories: string[] = [];
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "flymrp-components-")); directories.push(dir);
  await mkdir(join(dir, "system")); await writeFile(join(dir, "system/font.bin"), new Uint8Array([1, 2, 3]));
  await writeFile(join(dir, ".DS_Store"), "ignored");
  await symlink(join(dir, "system"), join(dir, "linked"));
  return dir;
}
describe("local handset resource directory", () => {
  it("preserves relative paths and binary bytes, skips hidden entries/symlinks, and permits a missing optional directory", async () => {
    const dir = await fixture(), files = await loadLocalSystemFiles(dir);
    expect(Object.keys(files)).toEqual(["system/font.bin"]);
    expect([...files["system/font.bin"]]).toEqual([1, 2, 3]);
    expect(await loadLocalSystemFiles(join(dir, "missing"))).toEqual({});
    expect(await loadLocalSystemFiles(undefined)).toEqual({});
    expect(systemFileHashes(files)["system/font.bin"]).toHaveLength(64);
  });
  it("preloads only the selected pack directory and refuses traversal", async () => {
    const dir = await fixture();
    await mkdir(join(dir, "GameA")); await writeFile(join(dir, "GameA/scene.bin"), "scene");
    await writeFile(join(dir, "GameA/old.sav"), "progress");
    await writeFile(join(dir, "GameA/GameA.mrp.sid"), "registration");
    await mkdir(join(dir, "GameB")); await writeFile(join(dir, "GameB/other.bin"), "other");
    expect(Object.keys(await loadGameResourceFiles(dir, "gamea.mrp"))).toEqual(["GameA/scene.bin"]);
    expect(await loadGameResourceFiles(dir, "../GameA.mrp")).toEqual({});
    expect(await loadGameResourceFiles(dir, "missing.mrp")).toEqual({});
  });
  it("serves enumerated hashes and refreshes the resource manifest without accepting filesystem paths", async () => {
    const dir = await fixture();
    let handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void = () => {};
    const register = localSystem(dir).configureServer as (server: Pick<ViteDevServer, "middlewares">) => void;
    register({ middlewares: { use(fn: typeof handler) { handler = fn; } } } as unknown as Pick<ViteDevServer, "middlewares">);
    const server = createServer((req, res) => handler(req, res, () => { res.statusCode = 404; res.end(); }));
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number }, base = `http://127.0.0.1:${address.port}`;
    try {
      let manifest = await (await fetch(base + "/__system")).json();
      expect(manifest[0].name).toBe("system/font.bin");
      expect([...new Uint8Array(await (await fetch(base + "/__system/" + manifest[0].sha256)).arrayBuffer())]).toEqual([1,2,3]);
      expect((await fetch(base + "/__system/system%2Ffont.bin")).status).toBe(404);
      expect([...new Uint8Array(await (await fetch(base + "/__system/file/system/font.bin")).arrayBuffer())]).toEqual([1, 2, 3]);
      expect((await fetch(base + "/__system/file/linked/font.bin")).status).toBe(404);
      expect((await fetch(base + "/__system/file/%2e%2e/system/font.bin")).status).toBe(404);
      expect((await fetch(base + "/__system", { method: "POST" })).status).toBe(405);
      await writeFile(join(dir, "system/new.dat"), "new");
      manifest = await (await fetch(base + "/__system")).json(); expect(manifest).toHaveLength(2);
    } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
  });
  it("serves one resource file by relative path and refuses saves, traversal, and other packs", async () => {
    const dir = await fixture();
    await mkdir(join(dir, "GameA")); await writeFile(join(dir, "GameA/scene.bin"), "scene");
    await writeFile(join(dir, "GameA/old.sav"), "progress");
    await mkdir(join(dir, "GameB")); await writeFile(join(dir, "GameB/other.bin"), "other");
    let handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void = () => {};
    const register = localSystem(dir, true).configureServer as (server: Pick<ViteDevServer, "middlewares">) => void;
    register({ middlewares: { use(fn: typeof handler) { handler = fn; } } } as unknown as Pick<ViteDevServer, "middlewares">);
    const server = createServer((req, res) => handler(req, res, () => { res.statusCode = 404; res.end(); }));
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number }, base = `http://127.0.0.1:${address.port}`;
    try {
      expect(await (await fetch(base + "/__resources/file/GameA/scene.bin?game=gamea.mrp")).text()).toBe("scene");
      expect((await fetch(base + "/__resources/file/GameA/old.sav?game=gamea.mrp")).status).toBe(404);
      expect((await fetch(base + "/__resources/file/GameB/other.bin?game=gamea.mrp")).status).toBe(404);
      expect((await fetch(base + "/__resources/file/GameA/scene.bin")).status).toBe(404);
      expect((await fetch(base + "/__resources/file/%2e%2e/GameA/scene.bin?game=gamea.mrp")).status).toBe(404);
    } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
  });
});
