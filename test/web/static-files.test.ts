import { mkdtemp, mkdir, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fileSha256, listMrpFiles, publishGames, type SelectedGame } from "../../tools/static-files.ts";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
async function setup() { const root = await mkdtemp(join(tmpdir(),"flymrp-publish-")); roots.push(root); const source=join(root,"source"),output=join(root,"dist/games"); await mkdir(source);return {source,output}; }
describe("static game library", () => {
  it("preserves duplicate names and Chinese paths, skips unchanged files, and detects same-size edits", async () => {
    const { source, output } = await setup(); await mkdir(join(source,"中文目录"));
    await writeFile(join(source,"game.mrp"),"old1"); await writeFile(join(source,"中文目录/game.MRP"),"old2");
    await writeFile(join(source,"notes.txt"),"not a game");
    const first = await publishGames(source,output); expect(first.copied).toBe(2); expect(first.skipped).toBe(0);
    expect(first.games.map(g=>g.name)).toEqual(["game.mrp","中文目录/game.MRP"]);
    const before=await stat(join(output,"game.mrp"));
    const second=await publishGames(source,output);expect(second.copied).toBe(0);expect(second.skipped).toBe(2);
    expect((await stat(join(output,"game.mrp"))).mtimeMs).toBe(before.mtimeMs);
    const original=await stat(join(source,"game.mrp")); await writeFile(join(source,"game.mrp"),"new1");await utimes(join(source,"game.mrp"),original.atime,original.mtime);
    const third=await publishGames(source,output);expect(third.copied).toBe(1);expect(third.skipped).toBe(1);
    expect(await readFile(join(output,"game.mrp"),"utf8")).toBe("new1"); expect(third.games[0].sha256).not.toBe(first.games[0].sha256);
  });
  it("repairs a corrupted published file and does not follow symlinks", async () => {
    const { source, output }=await setup();await writeFile(join(source,"real.mrp"),"real");await symlink(join(source,"real.mrp"),join(source,"link.mrp"));
    const first=await publishGames(source,output);expect(first.games).toHaveLength(1);
    await writeFile(join(output,"real.mrp"),"fake");const next=await publishGames(source,output);expect(next.copied).toBe(1);expect(await readFile(join(output,"real.mrp"),"utf8")).toBe("real");
  });
  it("publishes only selected games and removes stale full-library output without touching sources", async () => {
    const { source, output } = await setup();
    await mkdir(join(source, "old"));
    await writeFile(join(source, "keep.mrp"), "keep");
    await writeFile(join(source, "old/extra.mrp"), "extra");
    await publishGames(source, output);
    const before = (await stat(join(output, "keep.mrp"))).mtimeMs;
    const selection: SelectedGame[] = [{ path: "keep.mrp", title: "保留游戏", category: "益智", sha256: await fileSha256(join(source, "keep.mrp")) }];
    const result = await publishGames(source, output, selection);
    expect(result).toMatchObject({ copied: 0, skipped: 1, removed: 1 });
    expect(result.games[0]).toMatchObject({ title: "保留游戏", category: "益智" });
    expect(await listMrpFiles(output)).toEqual(["keep.mrp"]);
    expect((await stat(join(output, "keep.mrp"))).mtimeMs).toBe(before);
    expect(await readFile(join(source, "old/extra.mrp"), "utf8")).toBe("extra");
  });
  it("rejects missing, changed, duplicate or escaping selections before pruning old output", async () => {
    const { source, output } = await setup();
    await writeFile(join(source, "game.mrp"), "game");
    await publishGames(source, output);
    const selected: SelectedGame = { path: "game.mrp", title: "游戏", category: "益智", sha256: await fileSha256(join(source, "game.mrp")) };
    for (const selection of [[{ ...selected, path: "missing.mrp" }], [{ ...selected, path: "../game.mrp" }], [{ ...selected, sha256: "bad" }], [selected, selected]]) {
      await expect(publishGames(source, output, selection)).rejects.toThrow();
      expect(await readFile(join(output, "game.mrp"), "utf8")).toBe("game");
    }
  });
});
