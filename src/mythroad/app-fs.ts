/**
 * In-memory writable Mythroad EFS.
 *
 * Separate from:
 *   - current-pack RDONLY alias (`CurrentPackFileBackend`)
 *   - MRP archive resource namespace (`MythroadVfs` / `MRPArchive`)
 *
 * Not IndexedDB. Not a host filesystem. Persistence is deferred.
 */
import { MR_FAILED, MR_IS_DIR, MR_IS_FILE, MR_SUCCESS } from "./constants.ts";

export type AppFsNode =
  | { kind: "dir" }
  | { kind: "file"; bytes: Uint8Array };

export class AppFileSystem {
  readonly nodes = new Map<string, AppFsNode>();

  normalize(name: string): string {
    // Handset EFS uses FAT-style case-insensitive filenames. Archive resource
    // names remain in the separate, case-sensitive MythroadVfs namespace.
    // ABI filenames arrive as byte strings. Decode before folding case or
    // separators: a GBK trailing byte can itself be ASCII A-Z or backslash.
    if (/[\x80-\xff]/.test(name) && !/[^\x00-\xff]/.test(name)) {
      name = new TextDecoder('gbk').decode(Uint8Array.from(name, c => c.charCodeAt(0)));
    }
    return name.replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase()
      .replace(/^(?:c:)?\/?mythroad(?:\/|$)/, '').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '');
  }

  clear(): void {
    this.nodes.clear();
  }

  info(name: string): number | null {
    const key = this.normalize(name);
    if (!key) return null;
    const node = this.nodes.get(key);
    if (!node) return null;
    return node.kind === "dir" ? MR_IS_DIR : MR_IS_FILE;
  }

  /**
   * rxgj `my_mkDir`: existing path (file or dir) returns `MR_SUCCESS`.
   * Missing path becomes a directory.
   */
  mkdir(name: string): number {
    const key = this.normalize(name);
    if (!key) return MR_FAILED;
    if (this.nodes.has(key)) return MR_SUCCESS;
    this.nodes.set(key, { kind: "dir" });
    return MR_SUCCESS;
  }

  file(name: string): Uint8Array | null {
    const node = this.nodes.get(this.normalize(name));
    return node?.kind === "file" ? node.bytes : null;
  }

  remove(name: string): number {
    const key = this.normalize(name);
    if (this.nodes.get(key)?.kind !== "file") return MR_FAILED;
    this.nodes.delete(key);
    return MR_SUCCESS;
  }

  /** Native rmdir removes an existing empty directory, never its children. */
  rmdir(name: string): number {
    const key = this.normalize(name);
    if (!key || this.nodes.get(key)?.kind !== "dir") return MR_FAILED;
    for (const child of this.nodes.keys()) if (child.startsWith(key + "/")) return MR_FAILED;
    this.nodes.delete(key);
    return MR_SUCCESS;
  }

  /**
   * CREATE/RECREATE: parent dirs are created in-memory.
   * Existing dir at `name` cannot become a file.
   */
  createFile(name: string, recreate: boolean): Uint8Array | null {
    const key = this.normalize(name);
    if (!key) return null;
    const existing = this.nodes.get(key);
    if (existing?.kind === "dir") return null;
    if (existing?.kind === "file" && !recreate) return existing.bytes;
    this.ensureParents(key);
    const bytes = new Uint8Array(0);
    this.nodes.set(key, { kind: "file", bytes });
    return bytes;
  }

  replace(name: string, bytes: Uint8Array): void {
    const key = this.normalize(name);
    if (!key) return;
    this.nodes.set(key, { kind: "file", bytes });
  }

  private ensureParents(key: string): void {
    const parts = key.split("/");
    let acc = "";
    for (let i = 0; i < parts.length - 1; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i]!;
      if (!this.nodes.has(acc)) this.nodes.set(acc, { kind: "dir" });
    }
  }
}
