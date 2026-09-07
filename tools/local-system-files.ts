import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";

/** Read an explicitly selected handset directory; never follow nested symlinks. */
export async function loadLocalSystemFiles(directory: string | undefined): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {};
  if (!directory) return files;
  async function visit(dir: string): Promise<void> {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch (e) { if (dir === directory && (e as NodeJS.ErrnoException).code === "ENOENT") return; throw e; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".")) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files[relative(directory!, path).replace(/\\/g, "/")] = new Uint8Array(await readFile(path));
    }
  }
  await visit(directory);
  return files;
}
export function systemFileHashes(files: Readonly<Record<string, Uint8Array>>): Record<string, string> {
  return Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, createHash("sha256").update(bytes).digest("hex")]));
}
