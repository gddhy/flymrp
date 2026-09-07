import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadGb16Uc2, MythroadRuntime } from "../../src/mythroad/index.ts";
import { inferScreenSize } from "../../src/mythroad/device-size.ts";

const [directory, countArg = "40", output = "batch-results.json"] = process.argv.slice(2);
if (!directory) throw new Error("Usage: npm run test:games -- <directory> [count=40] [output.json]");

if (directory === "--worker") {
  const path = countArg;
  const bytes = readFileSync(path);
  const { width, height } = inferScreenSize(path);
  loadGb16Uc2(readFileSync(new URL("../../assets/system/gb16.uc2", import.meta.url)));
  const rt = new MythroadRuntime({ profile: { width, height } });
  let phase = "load";
  let started = false;
  let bootFrames = 0;
  let inputFrames = 0;
  let keysTested = 0;
  const hashes = new Set<string>();
  const fingerprint = () => createHash("sha256").update(new Uint8Array(rt.screen.pixels.buffer)).digest("hex");
  const tick = (n: number) => {
    for (let i = 0; i < n; i++) {
      rt.advance(80);
      for (let j = 0; j < 16 && rt.step(); j++);
      hashes.add(fingerprint());
    }
  };
  let error: string | null = null;
  try {
    rt.loadMrp(bytes);
    phase = "start";
    rt.start();
    started = true;
    phase = "boot";
    tick(40);
    bootFrames = hashes.size;
    phase = "input";
    for (const key of ["SOFTRIGHT", "FIRE", "FIRE", "DOWN", "FIRE", "RIGHT", "UP", "LEFT", 5, 2, 8]) {
      const before = fingerprint();
      rt.input.press(key);
      tick(2);
      rt.input.release(key);
      tick(8);
      if (before !== fingerprint()) inputFrames++;
      keysTested++;
    }
    phase = "complete";
  } catch (e) {
    error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
  const nonBlack = rt.screen.pixels.some(p => p !== 0);
  const classification = rt.exited ? "exited" : error ? "runtime-error" : !nonBlack ? "black-screen" :
    inputFrames > 0 ? "input-smoke-passed" : "static-frame";
  console.log(JSON.stringify({ sha256: createHash("sha256").update(bytes).digest("hex"), width, height, started,
    classification, keysTested, phase, bootFrames, inputFrames, distinctFrames: hashes.size, nonBlack,
    exited: rt.exited, unknownSlot: rt.unknownRequiredSlot, error }));
} else {
  const root = resolve(directory);
  const count = Number(countArg);
  if (!Number.isInteger(count) || count < 1) throw new Error("count must be a positive integer");
  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) :
      e.isFile() && /\.mrp$/i.test(e.name) ? [join(dir, e.name)] : []);
  }
  const files = walk(root);
  // Deterministic stratified sampling: round-robin top-level collections, SHA-256 path order within each.
  const groups = new Map<string, string[]>();
  for (const file of files) {
    const group = relative(root, file).split("/")[0];
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(file);
  }
  const rank = (p: string) => createHash("sha256").update(relative(root, p)).digest("hex");
  const buckets = [...groups].sort(([a], [b]) => a.localeCompare(b, "en")).map(([, paths]) => paths.sort((a,b) => rank(a).localeCompare(rank(b))));
  const selected: string[] = [];
  for (let i = 0; selected.length < Math.min(count, files.length); i++) {
    for (const bucket of buckets) if (bucket[i] && selected.length < count) selected.push(bucket[i]);
  }
  const results: unknown[] = [];
  for (const [i, path] of selected.entries()) {
    const start = Date.now();
    const run = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url), "--worker", path], {
      encoding: "utf8", timeout: 30_000, maxBuffer: 2 * 1024 * 1024,
    });
    let result;
    try { result = JSON.parse(run.stdout.trim().split("\n").at(-1)!); }
    catch { result = { classification: (run.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT" ? "worker-timeout" : "worker-error", phase: "worker", error: run.error?.message ?? run.stderr.slice(-1500), signal: run.signal }; }
    const row = { path: relative(root, path), ...result, elapsedMs: Date.now() - start };
    results.push(row);
    console.log(`[${i + 1}/${selected.length}] ${basename(path)}: ${result.error ?? `${result.classification} frames=${result.distinctFrames} inputChanges=${result.inputFrames}`}`);
    writeFileSync(output, JSON.stringify({ totalFiles: files.length, sampled: selected.length, method: "stratified-path-sha256-v1", results }, null, 2) + "\n");
  }
}
