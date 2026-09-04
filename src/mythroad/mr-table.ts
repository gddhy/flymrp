import { EXT_STACK_ADDR, EXT_TABLE_COUNT, MR_MAX_FILENAME_SIZE, tableSlotIndex } from "../abi/layout.ts";
import type { ExtRuntime } from "../abi/runtime.ts";
import { UnknownAbiError } from "../err/errors.ts";
import type { GuestMemory } from "../hot/memory.ts";
import { MR_SUCCESS } from "./constants.ts";
import { CurrentPackFileBackend, type PackFileSource } from "./pack-file.ts";
import { aapcsSprintfVararg, guestSprintf } from "./sprintf.ts";
import type { MythroadVfs } from "./vfs.ts";

/**
 * rxgj FULL `_mr_TestCom` under `#ifdef MR_PLAT_DRAWTEXT`.
 * Not universal Mythroad. Not a flymrp capability probe.
 */
export const MR_TESTCOM_CASE7 = 7;

/**
 * Observed LIVE `mr_platEx` code. `0x4c6 == 1222 == MR_TURONBACKLIGHT` numerically.
 * This stage only returns `MR_SUCCESS`; it is not a backlight implementation.
 */
export const MR_PLATEX_CODE_4C6 = 0x4c6;

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
 * Mythroad `mr_table[0]` / `[14]` / `[125]` / `[130]` (case 7) / `[38]` (code 0x4c6 only) /
 * `[33]` (`mr_getTime`) / `[17]` (`sprintf_` literal + `%d` only) /
 * `[40]`/`[44]`/`[45]`/`[41]` current-pack read-only file alias /
 * `[3]` `memcpy2` / `[10]` `strcmp2`.
 * table[100] is a 128-byte `pack_filename` data slot, not a function ABI.
 * Uses the existing EXT bump heap. Does not implement `mr_free` (table[1]).
 */
export class MrTableBridge {
  readonly allocs: AllocRecord[] = [];
  readonly reads: ReadFileRecord[] = [];
  readonly files: CurrentPackFileBackend;
  unknownRequiredSlot: number | null = null;
  /**
   * Isolated-test clock when `hooks.getClock` is absent.
   * Production always reads `MythroadRuntime.clock` via `getClock`.
   */
  clock = 0;

  constructor(
    readonly ext: ExtRuntime,
    readonly vfs: MythroadVfs,
    readonly owner: string,
    readonly hooks: {
      onUnknownSlot?: (n: number) => void;
      onAlloc?: (rec: AllocRecord) => void;
      onRead?: (rec: ReadFileRecord) => void;
      getClock?: () => number;
      getPack?: () => PackFileSource | null;
    } = {},
  ) {
    this.files = new CurrentPackFileBackend(() => this.hooks.getPack?.() ?? null);
  }

  install(): void {
    this.ext.registerHandler(0, (_cpu, _mem, args) => this.malloc(args[0]! >>> 0));
    this.ext.registerHandler(3, (_cpu, mem, args) => memcpy2(mem, args[0]!, args[1]!, args[2]!));
    this.ext.registerHandler(10, (_cpu, mem, args) => strcmp2(mem, args[0]!, args[1]!));
    this.ext.registerHandler(14, (_cpu, mem, args) => this.memset(mem, args[0]!, args[1]!, args[2]!));
    this.ext.registerHandler(125, (_cpu, mem, args) => this.readFile(mem, args[0]! >>> 0, args[1]! >>> 0, args[2]! | 0));
    this.ext.registerHandler(130, (_cpu, _mem, args) => this.testCom(args));
    this.ext.registerHandler(38, (_cpu, _mem, args) => this.platEx(args));
    this.ext.registerHandler(33, (_cpu, _mem, _args) => this.getTime());
    this.ext.registerHandler(17, (_cpu, mem, args) => this.sprintf(mem, args));
    this.ext.registerHandler(40, (_cpu, mem, args) => this.open(mem, args[0]! >>> 0, args[1]! >>> 0));
    this.ext.registerHandler(41, (_cpu, _mem, args) => this.files.close(args[0]! | 0));
    this.ext.registerHandler(44, (_cpu, mem, args) => this.files.read(mem, args[0]! | 0, args[1]! >>> 0, args[2]! >>> 0));
    this.ext.registerHandler(45, (_cpu, _mem, args) => this.files.seek(args[0]! | 0, args[1]! | 0, args[2]! | 0));
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
   * table[130] = `asm_mr_TestCom` = `_mr_TestCom`.
   *
   * This is rxgj FULL compatibility behavior (`#ifdef MR_PLAT_DRAWTEXT` case 7:
   * `return input1`). It is not claimed to be universal Mythroad behavior.
   *
   * rxgj `aex_t130`: `_mr_TestCom(NULL, (int)r1, (int)r2)`. Guest r0 / r3 ignored.
   * Only `input0 == 7` is implemented. Any other case is UnknownAbiError.
   */
  testCom(args: Uint32Array): number {
    const input0 = args[1]! | 0;
    const input1 = args[2]! | 0;
    if (input0 === MR_TESTCOM_CASE7) return input1;
    throw new UnknownAbiError(`unsupported TestCom case ${input0}`, {
      family: "_mr_TestCom",
      code: input0,
      caller: "ext",
    });
  }

  /**
   * table[33] = `asm_mr_getTime` = `mr_getTime`.
   *
   * `uint32 mr_getTime(void)` — zero-argument ABI. Incoming R0–R3 / stack
   * are not parameters.
   *
   * mr_getTime is backed by flymrp's deterministic runtime clock.
   * The ARM ABI exposes the low 32 bits as uint32 milliseconds.
   * It does not use JavaScript wall-clock time.
   *
   * Guest-observable epoch is elapsed monotonic milliseconds since
   * runtime start (`MythroadRuntime.clock` initial value 0). This is
   * the rxgj FULL guest semantic (`get_uptime_ms() - dsmStartTime`),
   * not a second host-timestamp layer.
   */
  getTime(): number {
    const n = this.hooks.getClock ? this.hooks.getClock() : this.clock;
    return n >>> 0;
  }

  /**
   * table[17] = `sprintf_`.
   *
   * `int sprintf_(char *buffer, const char *format, ...)`.
   *
   * Only the observed guest sprintf subset consisting of
   * literal bytes and `%d` is currently implemented.
   *
   * Guest-aware: R0=buffer, R1=format, first vararg=R2 (`format_arm` first_arg=2).
   * `%d` is guest ARM int32. Other specifiers throw UnknownAbiError.
   * Does not construct a host va_list.
   *
   * Return is bytes written excluding the trailing NUL (mpaland `sprintf_`).
   */
  sprintf(mem: GuestMemory, args: Uint32Array): number {
    return guestSprintf(mem, args[0]! >>> 0, args[1]! >>> 0, (index) => aapcsSprintfVararg(args, index));
  }

  /**
   * table[38] = `asm_mr_platEx` = `mr_platEx`.
   *
   * This is rxgj FULL compatibility behavior for the observed
   * `mr_platEx(0x4c6, NULL, 0, NULL, NULL, NULL)` call.
   *
   * It is not claimed to implement the complete `mr_platEx` API
   * or universal Mythroad platform behavior. No backlight / Canvas /
   * DOM / device side effects.
   *
   * AAPCS: r0=code r1=input r2=input_len r3=output [sp]=output_len [sp+4]=cb.
   * Only `code == 0x4c6` is implemented: return `MR_SUCCESS` (0).
   */
  platEx(args: Uint32Array): number {
    const code = args[0]! >>> 0;
    const input = args[1]! >>> 0;
    const inputLen = args[2]! >>> 0;
    const output = args[3]! >>> 0;
    const outputLen = args[4]! >>> 0;
    const cb = args[5]! >>> 0;
    if (code === MR_PLATEX_CODE_4C6) {
      void input;
      void inputLen;
      void output;
      void outputLen;
      void cb;
      return MR_SUCCESS;
    }
    throw new UnknownAbiError(`unsupported mr_platEx code ${code}`, {
      family: "mr_platEx",
      code,
      caller: "ext",
    });
  }

  /**
   * table[40] = `asm_mr_open` = `mr_open`.
   *
   * `int32 mr_open(const char *filename, uint32 mode)`.
   *
   * Only `filename === current packName` and `mode === MR_FILE_RDONLY` (1)
   * are implemented. Other names/modes are unsupported flymrp ABI
   * (`UnknownAbiError`), not a guest-visible open failure (0).
   */
  open(mem: GuestMemory, nameAddr: number, mode: number): number {
    return this.files.open(readGuestCString(mem, nameAddr), mode >>> 0);
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

  /**
   * `memcpy2(dest, src, count)` — mythroad.c `_mr_c_function_table[3]`.
   * Forward byte copy. Not memmove. count==0 does not touch pointers.
   */
  memcpy(mem: GuestMemory, dest: number, src: number, count: number): number {
    return memcpy2(mem, dest, src, count);
  }

  /**
   * `strcmp2(cs, ct)` — mythroad.c `_mr_c_function_table[10]`.
   * unsigned-char byte compare. Returns -1 / 0 / 1.
   */
  strcmp(mem: GuestMemory, cs: number, ct: number): number {
    return strcmp2(mem, cs, ct);
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

/**
 * rxgj `string.c` `memcpy2`. Forward `read8` then `write8` per byte.
 * Overlap is guest-visible self-overwrite, not memmove / TypedArray.set.
 * `count === 0` returns dest without accessing either pointer.
 */
export function memcpy2(mem: GuestMemory, dest: number, src: number, count: number): number {
  const dst = dest >>> 0;
  const from = src >>> 0;
  const n = count >>> 0;
  if (n === 0) return dst;
  for (let i = 0; i < n; i++) {
    const b = mem.read8((from + i) >>> 0);
    mem.write8((dst + i) >>> 0, b);
  }
  return dst;
}

/**
 * rxgj `string.c` `strcmp2`. Loads into `unsigned char`, returns -1 / 0 / 1.
 * Stops at the first difference or NUL. Does not decode UTF-8 / locale.
 */
export function strcmp2(mem: GuestMemory, cs: number, ct: number): number {
  let a = cs >>> 0;
  let b = ct >>> 0;
  for (;;) {
    const c1 = mem.read8(a) & 0xff;
    const c2 = mem.read8(b) & 0xff;
    a = (a + 1) >>> 0;
    b = (b + 1) >>> 0;
    if (c1 !== c2) return c1 < c2 ? -1 : 1;
    if (c1 === 0) return 0;
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
