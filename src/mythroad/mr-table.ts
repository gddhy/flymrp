import { EXT_STACK_ADDR, EXT_TABLE_COUNT, tableSlotIndex } from "../abi/layout.ts";
import type { ExtRuntime } from "../abi/runtime.ts";
import type { GuestMemory } from "../hot/memory.ts";
import type { MythroadVfs } from "./vfs.ts";

const MR_MAX_FILENAME_SIZE = 128;

export type AllocRecord = {
  size: number;
  alignedSize: number;
  guestAddr: number;
  owner: string;
};

export type ReadFileRecord = {
  name: string;
  lookfor: number;
  guestAddr: number;
  length: number;
};

/**
 * Mythroad `mr_table[0]` / `[14]` / `[125]` — confirmed in mr_helper.h + mythroad.c.
 * Uses the existing EXT bump heap. Does not implement `mr_free` (table[1]).
 */
export class MrTableBridge {
  readonly allocs: AllocRecord[] = [];
  readonly reads: ReadFileRecord[] = [];
  unknownRequiredSlot: number | null = null;

  constructor(
    readonly ext: ExtRuntime,
    readonly vfs: MythroadVfs,
    readonly owner: string,
    readonly hooks: {
      onUnknownSlot?: (n: number) => void;
      onAlloc?: (rec: AllocRecord) => void;
      onRead?: (rec: ReadFileRecord) => void;
    } = {},
  ) {}

  install(): void {
    this.ext.registerHandler(0, (_cpu, _mem, args) => this.malloc(args[0]! >>> 0));
    this.ext.registerHandler(14, (_cpu, mem, args) => this.memset(mem, args[0]!, args[1]!, args[2]!));
    this.ext.registerHandler(125, (_cpu, mem, args) => this.readFile(mem, args[0]! >>> 0, args[1]! >>> 0, args[2]! | 0));
    if (!this.hooks.onUnknownSlot) return;
    const orig = this.ext.table.dispatch.bind(this.ext.table);
    this.ext.table.dispatch = (cpu, mem, pc) => {
      const n = tableSlotIndex(pc);
      if (n >= 0 && n < EXT_TABLE_COUNT && this.ext.table.isExec(n) && !this.ext.table.handlers[n]) {
        this.unknownRequiredSlot = n;
        this.hooks.onUnknownSlot!(n);
      }
      orig(cpu, mem, pc);
    };
  }

  /**
   * `memset2(s, c, count)` — mythroad.c `_mr_c_function_table[14]`.
   * Returns `s` (guest dest). `c` is the low 8 bits. `count` is size_t.
   */
  memset(mem: GuestMemory, dest: number, value: number, length: number): number {
    const dst = dest >>> 0;
    const n = length >>> 0;
    if (n) mem.fill(dst, value & 0xff, n);
    return dst;
  }

  malloc(size: number): number {
    const want = size >>> 0;
    if (want === 0) return 0;
    const aligned = (want + 7) & ~7;
    if ((this.ext.heapTop >>> 0) + aligned > EXT_STACK_ADDR) return 0;
    const guestAddr = this.ext.alloc(want) >>> 0;
    const rec = { size: want, alignedSize: aligned, guestAddr, owner: this.owner };
    this.allocs.push(rec);
    this.hooks.onAlloc?.(rec);
    return guestAddr;
  }

  readFile(mem: GuestMemory, nameAddr: number, lenAddr: number, lookfor: number): number {
    const name = readGuestCString(mem, nameAddr);
    if (!name) {
      this.noteRead({ name: "", lookfor, guestAddr: 0, length: 0 });
      return 0;
    }
    if (lookfor === 1) {
      const ok = this.vfs.exists(name) ? 1 : 0;
      this.noteRead({ name, lookfor, guestAddr: ok, length: 0 });
      return ok;
    }
    if (lookfor !== 0 && lookfor !== 2) {
      this.noteRead({ name, lookfor, guestAddr: 0, length: 0 });
      return 0;
    }
    const data = this.vfs.readFile(name);
    if (!data) {
      this.noteRead({ name, lookfor, guestAddr: 0, length: 0 });
      return 0;
    }
    const guestAddr = this.malloc(data.length);
    if (!guestAddr) {
      this.noteRead({ name, lookfor, guestAddr: 0, length: 0 });
      return 0;
    }
    this.ext.mem.load(guestAddr, data);
    if (lenAddr) mem.write32(lenAddr, data.length);
    this.noteRead({ name, lookfor, guestAddr, length: data.length });
    return guestAddr;
  }

  private noteRead(rec: ReadFileRecord): void {
    this.reads.push(rec);
    this.hooks.onRead?.(rec);
  }
}

export function readGuestCString(mem: GuestMemory, addr: number, max = MR_MAX_FILENAME_SIZE): string {
  if (!addr) return "";
  let s = "";
  for (let i = 0; i < max; i++) {
    const b = mem.read8((addr + i) >>> 0);
    if (b === 0) break;
    s += String.fromCharCode(b);
  }
  return s;
}
