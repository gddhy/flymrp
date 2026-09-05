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
    return name.replace(/\/+$/g, "");
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
}
