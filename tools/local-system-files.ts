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

/** Only preload the selected game's directory, not the entire resource collection. */
export async function loadGameResourceFiles(directory: string | undefined, packName: string): Promise<Record<string, Uint8Array>> {
  if (!directory || !/^[a-z0-9_.-]+\.mrp$/i.test(packName)) return {};
  const stem = packName.slice(0, -4).toLowerCase();
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return {}; throw e; }
  const matches = entries.filter(entry => entry.isDirectory() && entry.name.toLowerCase() === stem);
  if (matches.length !== 1) return {};
  const name = matches[0].name, files = await loadLocalSystemFiles(join(directory, name));
  return Object.fromEntries(Object.entries(files).filter(([path]) => isGameResource(path)).map(([path, bytes]) => [`${name}/${path}`, bytes]));
}

/** Known handset progress/registration files are not downloadable game assets. */
export function isGameResource(path: string): boolean {
  const name = path.split("/").at(-1)!;
  return !/\.(sav|sms|sid)$/i.test(name) && !/^fsarpg\d/i.test(name) && name.toUpperCase() !== "HERO_BAG";
}
