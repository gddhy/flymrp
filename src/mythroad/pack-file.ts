/** Current MRP containers and EFS handles. Container writes use a session-local
 * copy so guest save/registration headers never mutate an uploaded archive. */
import { UnknownAbiError } from "../err/errors.ts";
import type { GuestMemory } from "../hot/memory.ts";
import type { AppFileSystem } from "./app-fs.ts";
import {
  MR_FAILED,
  MR_FILE_CREATE,
  MR_FILE_RDONLY,
  MR_FILE_RDWR,
  MR_FILE_RECREATE,
  MR_FILE_WRONLY,
  MR_SEEK_CUR,
  MR_SEEK_END,
  MR_SEEK_SET,
  MR_SUCCESS,
} from "./constants.ts";

export type ReadOnlyFileHandle = {
  bytes: Uint8Array;
  pos: number;
  writable: boolean;
  efsKey: string | null;
  packSource?: Uint8Array;
};

export type PackFileSource = {
  name: string;
  bytes: Uint8Array;
};

export type PackFileOp = {
  op: "open" | "read" | "write" | "seek" | "close";
  handle: number;
  ret: number;
  pos: number;
  requested?: number;
  origin?: number;
  offset?: number;
};

const ACCESS = MR_FILE_RDONLY | MR_FILE_WRONLY | MR_FILE_RDWR;
const FLAGS = MR_FILE_CREATE | MR_FILE_RECREATE;

export class CurrentPackFileBackend {
  private readonly handles = new Map<number, ReadOnlyFileHandle>();
  private nextHandle = 1;
  private packCopies = new WeakMap<Uint8Array, Uint8Array>();
  readonly ops: PackFileOp[] = [];

  constructor(
    private readonly getPack: () => PackFileSource | null,
    private readonly appFs: AppFileSystem | null = null,
  ) {}

  reset(): void {
    this.handles.clear();
    this.packCopies = new WeakMap();
    this.nextHandle = 1;
    this.ops.length = 0;
    this.appFs?.clear();
  }

  peek(f: number): ReadOnlyFileHandle | null {
    return this.handles.get(f | 0) ?? null;
  }

  getLen(filename: string): number {
    const pack = this.getPack();
    if (pack && filename === pack.name) return (this.packCopies.get(pack.bytes) ?? pack.bytes).length;
    return this.appFs?.file(filename)?.length ?? MR_FAILED;
  }

  remove(filename: string): number {
    // The uploaded container is read-only; only the guest's EFS can be changed.
    if (filename === this.getPack()?.name) return MR_FAILED;
    return this.appFs?.remove(filename) ?? MR_FAILED;
  }

  rename(from: string, to: string): number {
    const fs = this.appFs;
    if (!fs || from === this.getPack()?.name || to === this.getPack()?.name) return MR_FAILED;
    const source = fs.normalize(from), target = fs.normalize(to), node = fs.nodes.get(source);
    if (!source || !target || node?.kind !== "file" || fs.nodes.get(target)?.kind === "dir") return MR_FAILED;
    if (source === target) return MR_SUCCESS;
    fs.nodes.delete(source); fs.nodes.set(target, node);
    for (const handle of this.handles.values()) {
      if (handle.efsKey === source) handle.efsKey = target;
      else if (handle.efsKey === target) handle.efsKey = null;
    }
    return MR_SUCCESS;
  }

  /**
   * `int32 mr_open(const char *filename, uint32 mode)`.
   * Success = positive handle. Pack writes stay in a private session copy.
   * Missing EFS without CREATE = 0.
   */
  open(filename: string, mode: number): number {
    const pack = this.getPack();
    const m = mode >>> 0;
    if (pack && filename === pack.name) {
      const access = m & ACCESS;
      if (![MR_FILE_RDONLY, MR_FILE_WRONLY, MR_FILE_RDWR].includes(access) || (m & ~(ACCESS | FLAGS))) {
        throw new UnknownAbiError(`unsupported mr_open mode ${m}`, { family: "mr_open", code: m, caller: "ext" });
      }
      const writable = access !== MR_FILE_RDONLY || Boolean(m & MR_FILE_RECREATE);
      let bytes = this.packCopies.get(pack.bytes) ?? pack.bytes;
      if (writable && (!this.packCopies.has(pack.bytes) || (m & MR_FILE_RECREATE))) {
        bytes = m & MR_FILE_RECREATE ? new Uint8Array() : bytes.slice();
        this.updatePack(pack.bytes, bytes);
      }
      const handle = this.addHandle(bytes, writable, null);
      this.handles.get(handle)!.packSource = pack.bytes;
      return handle;
    }
    if (!this.appFs) {
      throw new UnknownAbiError(`unsupported mr_open filename ${JSON.stringify(filename)}`, {
        family: "mr_open",
        code: filename || "(empty)",
        caller: "ext",
      });
    }
    return this.openEfs(filename, m);
  }

  private updatePack(source: Uint8Array, bytes: Uint8Array): void {
    this.packCopies.set(source, bytes);
    for (const handle of this.handles.values()) if (handle.packSource === source) handle.bytes = bytes;
  }

  private openEfs(filename: string, mode: number): number {
    const access = mode & ACCESS;
    const flags = mode & FLAGS;
    if (!filename || access === 0 || (mode & ~(ACCESS | FLAGS)) !== 0) return 0;
    const recreate = (flags & MR_FILE_RECREATE) !== 0;
    const create = recreate || (flags & MR_FILE_CREATE) !== 0;
    const writable = access !== MR_FILE_RDONLY || recreate;
    const fs = this.appFs!;
    const existing = fs.file(filename);
    if (existing && !recreate) return this.addHandle(existing, writable, fs.normalize(filename));
    if (!create) return 0;
    const created = fs.createFile(filename, recreate);
    if (!created) return 0;
    return this.addHandle(created, true, fs.normalize(filename));
  }

  private addHandle(bytes: Uint8Array, writable: boolean, efsKey: string | null): number {
    const id = this.nextHandle++;
    this.handles.set(id, { bytes, pos: 0, writable, efsKey });
    this.ops.push({ op: "open", handle: id, ret: id, pos: 0 });
    return id;
  }

  /**
   * `int32 mr_read(int32 f, void *p, uint32 l)`.
   * Returns bytes copied. EOF = 0. Invalid handle = MR_FAILED.
   * Unmapped dest is GuestMemory MemoryFault (not converted to -1).
   */
  read(mem: GuestMemory, f: number, dest: number, len: number): number {
    const h = this.handles.get(f | 0);
    if (!h) {
      this.ops.push({ op: "read", handle: f | 0, ret: MR_FAILED, pos: -1, requested: len >>> 0 });
      return MR_FAILED;
    }
    const requested = len >>> 0;
    if (requested === 0) {
      this.ops.push({ op: "read", handle: f | 0, ret: 0, pos: h.pos, requested: 0 });
      return 0;
    }
    const remain = h.pos >= h.bytes.length ? 0 : h.bytes.length - h.pos;
    const n = requested < remain ? requested : remain;
    if (n) {
      mem.load(dest >>> 0, h.bytes.subarray(h.pos, h.pos + n));
      h.pos += n;
    }
    this.ops.push({ op: "read", handle: f | 0, ret: n, pos: h.pos, requested });
    return n;
  }

  /**
   * `int32 mr_write(int32 f, void *p, uint32 l)`.
   * Read-only handles return MR_FAILED.
   * Extends the file with zeros if the cursor is past EOF.
   */
  write(mem: GuestMemory, f: number, src: number, len: number): number {
    const h = this.handles.get(f | 0);
    if (!h || !h.writable || (!h.packSource && (!h.efsKey || !this.appFs))) {
      this.ops.push({ op: "write", handle: f | 0, ret: MR_FAILED, pos: h?.pos ?? -1, requested: len >>> 0 });
      return MR_FAILED;
    }
    const n = len >>> 0;
    if (n === 0) {
      this.ops.push({ op: "write", handle: f | 0, ret: 0, pos: h.pos, requested: 0 });
      return 0;
    }
    const end = h.pos + n;
    if (end > 32 * 1024 * 1024) {
      this.ops.push({ op: "write", handle: f | 0, ret: MR_FAILED, pos: h.pos, requested: n });
      return MR_FAILED;
    }
    if (end > h.bytes.length || h.pos > h.bytes.length) {
      const grown = new Uint8Array(end);
      grown.set(h.bytes.subarray(0, Math.min(h.bytes.length, h.pos)));
      h.bytes = grown;
    }
    for (let i = 0; i < n; i++) h.bytes[h.pos + i] = mem.read8((src + i) >>> 0);
    h.pos = end;
    if (h.packSource) this.updatePack(h.packSource, h.bytes);
    else {
      this.appFs!.replace(h.efsKey!, h.bytes);
      for (const other of this.handles.values()) if (other.efsKey === h.efsKey) other.bytes = h.bytes;
    }
    this.ops.push({ op: "write", handle: f | 0, ret: n, pos: h.pos, requested: n });
    return n;
  }

  /**
   * `int32 mr_seek(int32 f, int32 pos, int method)`.
   * MR_SEEK_SET/CUR/END = 0/1/2. Beyond EOF is allowed (no clamp).
   * Negative resulting position or unknown origin: MR_FAILED, pos unchanged.
   */
  seek(f: number, offset: number, origin: number): number {
    const h = this.handles.get(f | 0);
    if (!h) {
      this.ops.push({
        op: "seek",
        handle: f | 0,
        ret: MR_FAILED,
        pos: -1,
        offset: offset | 0,
        origin: origin | 0,
      });
      return MR_FAILED;
    }
    const off = offset | 0;
    const method = origin | 0;
    let next: number;
    if (method === MR_SEEK_SET) next = off;
    else if (method === MR_SEEK_CUR) next = (h.pos | 0) + off;
    else if (method === MR_SEEK_END) next = (h.bytes.length | 0) + off;
    else {
      this.ops.push({ op: "seek", handle: f | 0, ret: MR_FAILED, pos: h.pos, offset: off, origin: method });
      return MR_FAILED;
    }
    if (next < 0) {
      this.ops.push({ op: "seek", handle: f | 0, ret: MR_FAILED, pos: h.pos, offset: off, origin: method });
      return MR_FAILED;
    }
    h.pos = next;
    this.ops.push({ op: "seek", handle: f | 0, ret: MR_SUCCESS, pos: h.pos, offset: off, origin: method });
    return MR_SUCCESS;
  }

  /** `int32 mr_close(int32 f)`. Valid → MR_SUCCESS and invalidate. Invalid / double close → MR_FAILED. */
  close(f: number): number {
    const id = f | 0;
    if (!this.handles.has(id)) {
      this.ops.push({ op: "close", handle: id, ret: MR_FAILED, pos: -1 });
      return MR_FAILED;
    }
    this.handles.delete(id);
    this.ops.push({ op: "close", handle: id, ret: MR_SUCCESS, pos: -1 });
    return MR_SUCCESS;
  }
}
