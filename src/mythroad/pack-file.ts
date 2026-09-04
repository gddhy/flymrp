/**
 * Stage 5-C.10K — current-pack read-only file backend.
 *
 * Only a deterministic virtual file alias for the currently loaded MRP
 * container (`packName` + `MR_FILE_RDONLY`). Other filenames and write
 * modes remain unsupported (UnknownAbiError, not a guest open-failure 0).
 *
 * Does not implement a host filesystem, VFS member lookup, or
 * archive.getResource. Guest reads `archive.data` as a byte stream.
 */
import { UnknownAbiError } from "../err/errors.ts";
import type { GuestMemory } from "../hot/memory.ts";
import { MR_FAILED, MR_FILE_RDONLY, MR_SEEK_CUR, MR_SEEK_END, MR_SEEK_SET, MR_SUCCESS } from "./constants.ts";

export type ReadOnlyFileHandle = {
  bytes: Uint8Array;
  pos: number;
};

export type PackFileSource = {
  name: string;
  bytes: Uint8Array;
};

export type PackFileOp = {
  op: "open" | "read" | "seek" | "close";
  handle: number;
  ret: number;
  pos: number;
  requested?: number;
  origin?: number;
  offset?: number;
};

export class CurrentPackFileBackend {
  private readonly handles = new Map<number, ReadOnlyFileHandle>();
  private nextHandle = 1;
  readonly ops: PackFileOp[] = [];

  constructor(private readonly getPack: () => PackFileSource | null) {}

  reset(): void {
    this.handles.clear();
    this.nextHandle = 1;
    this.ops.length = 0;
  }

  peek(f: number): ReadOnlyFileHandle | null {
    return this.handles.get(f | 0) ?? null;
  }

  /**
   * `int32 mr_open(const char *filename, uint32 mode)`.
   * Success = positive handle. Failure for this backend is not used:
   * unsupported name/mode throw UnknownAbiError.
   */
  open(filename: string, mode: number): number {
    const pack = this.getPack();
    if (!pack) {
      throw new UnknownAbiError("unsupported mr_open: no current pack", {
        family: "mr_open",
        code: "no-pack",
        caller: "ext",
      });
    }
    if ((mode >>> 0) !== MR_FILE_RDONLY) {
      throw new UnknownAbiError(`unsupported mr_open mode ${mode >>> 0}`, {
        family: "mr_open",
        code: mode >>> 0,
        caller: "ext",
      });
    }
    if (filename !== pack.name) {
      throw new UnknownAbiError(`unsupported mr_open filename ${JSON.stringify(filename)}`, {
        family: "mr_open",
        code: filename || "(empty)",
        caller: "ext",
      });
    }
    const id = this.nextHandle++;
    this.handles.set(id, { bytes: pack.bytes, pos: 0 });
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
