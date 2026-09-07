import { readFile, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import classics from "../../config/classic-games.json";
import { MRPArchive } from "../../src/mrp/index.ts";
import { loadGb16Uc2, MythroadRuntime } from "../../src/mythroad/index.ts";
import { inferScreenSize } from "../../src/mythroad/device-size.ts";
import { SYSTEM_COMPONENTS } from "../../src/mythroad/system-components.ts";
import { DEFAULT_NETWORK_RULES } from "../../src/mythroad/network-rules.ts";
import { loadGameResourceFiles } from "../local-system-files.ts";
import { fileSha256 } from "../static-files.ts";
import { FrameCapture } from "./frame-capture.ts";

// Startup check only. A visible startup frame is not proof of gameplay or controls.
const args = process.argv.slice(2), worker = args[0] === "--worker";
const root = resolve(process.env.MRP_GAME_DIR ?? "/Users/zixing/Downloads/mrp游戏大集结");
if (worker) {
  const path = resolve(args[1]), profile = inferScreenSize(path);
  let phase = "load", error: string | null = null, rt: MythroadRuntime | undefined;
  const display = new FrameCapture(() => rt!.screen, profile.width, profile.height);
  try {
    const bytes = await readFile(path);
    const packName = MRPArchive.parse(bytes).header.filename;
    const systemFiles = Object.fromEntries(await Promise.all(SYSTEM_COMPONENTS.map(async name => [name, new Uint8Array(await readFile(`assets/${name}`))] as const)));
    Object.assign(systemFiles, await loadGameResourceFiles(process.env.MRP_RESOURCE_DIR ?? join(root, "mythroad_res"), packName));
    loadGb16Uc2(systemFiles["system/gb16.uc2"]);
    rt = new MythroadRuntime({ profile, graphics: display, systemFiles, networkRules: DEFAULT_NETWORK_RULES, abiMode: "strict" });
    rt.loadMrp(bytes); phase = "start"; rt.start(); phase = "boot";
    for (let i = 0; i < 40; i++) {
      rt.advance(80);
      for (let j = 0; j < 16 && rt.step(); j++);
    }
    phase = "complete";
  } catch (e) { error = e instanceof Error ? `${e.name}: ${e.message}` : String(e); }
  const nonBlack = display.pixels.some(pixel => pixel !== 0);
  const outcome = error ? "runtime-error" : rt?.exited ? "exited" : !nonBlack ? "black-screen" : "boot-visible";
  console.log(JSON.stringify({ path, sha256: await fileSha256(path), phase, outcome, error, frames: display.frames, nonBlack }));
} else {
  const output = resolve(args[0] ?? "artifacts/classic-smoke");
  await mkdir(output, { recursive: true });
  const results: Record<string, unknown>[] = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (cursor < classics.games.length) {
      const game = classics.games[cursor++];
      const result = await new Promise<Record<string, unknown>>(done => {
        const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url), "--worker", join(root, game.path)], { stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "", stderr = "", timedOut = false;
        const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 30_000);
        child.stdout.on("data", data => { stdout += data; });
        child.stderr.on("data", data => { stderr += data; });
        child.on("error", error => { clearTimeout(timer); done({ outcome: "worker-error", error: error.message }); });
        child.on("close", () => {
          clearTimeout(timer);
          try { done(JSON.parse(stdout.trim().split("\n").at(-1)!)); }
          catch { done({ outcome: timedOut ? "worker-timeout" : "worker-error", error: stderr.slice(-1500) }); }
        });
      });
      if (result.sha256 && result.sha256 !== game.sha256) { result.outcome = "content-mismatch"; result.error = "Game differs from manifest"; }
      results.push({ ...result, path: game.path, title: game.title });
      console.log(`[${results.length}/100] ${game.title}: ${result.outcome}${result.error ? ` ${result.error}` : ""}`);
    }
  }));
  await writeFile(join(output, "results.json"), JSON.stringify({ method: "40x80ms-boot-only-with-production-resources", gameplayVerified: false,
    manifestSha256: await fileSha256("config/classic-games.json"), results: results.sort((a, b) => String(a.path).localeCompare(String(b.path))) }, null, 2) + "\n");
  if (results.some(result => result.outcome !== "boot-visible")) process.exitCode = 1;
}
