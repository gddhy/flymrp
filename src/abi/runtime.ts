import { ARMCPU, UnsupportedInsn } from "../hot/cpu.ts";
import { BlockCache } from "../hot/cache.ts";
import { GuestMemory, MemoryFault } from "../hot/memory.ts";
import { run } from "../hot/interp.ts";
import { ExtCallResult, ExtFault, ExtStopKind, ExtStopped } from "./fault.ts";
import {
  AEX_P_ER_RW_OFF,
  AEX_P_SIZE,
  EXT_BASE_ADDR,
  EXT_CODE_ADDR,
  EXT_HEAP_ADDR,
  EXT_LOW_TABLE_SIZE,
  EXT_MEM_SIZE,
  EXT_STACK_ADDR,
  EXT_STOP_ADDR,
  EXT_TABLE_ADDR,
  EXT_TABLE_COUNT,
  MR_FAILED,
  MR_MAX_FILENAME_SIZE,
  MR_SUCCESS,
  PACK_FILENAME_SLOT,
  stackTop,
  tableSlotAddr,
} from "./layout.ts";
import { mapExtImage, parseExtImage, type MappedExt } from "./loader.ts";
import { ModuleOwners } from "./owners.ts";
import { DATA_SLOTS, MrTable, dataSlotAllocSize, initTableMemory } from "./table.ts";

/**
 * Finite ARM/Thumb instruction watchdog per `runGuest` / `arm_ext_call`.
 * This is a safety/debug limit, not a browser event-loop execution slice.
 * Forensic runners may overwrite `ExtRuntime.insnBudget`; values are clamped to `MAX_INSN_BUDGET`.
 */
/**
 * Finite ARM watchdog per `runGuest`. Start of this fixture is ~1.60M.
 * Dismissing the LIVE sound dialog (`否`/`是`) extracts pack members
 * `71`–`79`/`18` into AppFS and needs ~5.10M. 8M is that path plus margin.
 * Not a browser event-loop slice. Ceiling is `MAX_INSN_BUDGET`.
 */
export const DEFAULT_INSN_BUDGET = 8_000_000;
export const MAX_INSN_BUDGET = 20_000_000;

export function createExtMemory(): GuestMemory {
  const mem = new GuestMemory(EXT_BASE_ADDR, EXT_MEM_SIZE);
  mem.map(0, EXT_LOW_TABLE_SIZE);
  return mem;
}

export type LoadOptions = {
  dest?: number;
  thumb?: boolean;
  loadCode?: number;
  stage?: boolean;
  runLoad?: boolean;
};

export type LoadResult = {
  pc?: number;
  detail?: string;
  mapped: MappedExt;
  ret: number;
  kind: ExtStopKind;
};

function align2(n: number): number {
  return (n + 1) & ~1;
}

function align8(n: number): number {
  return (n + 7) & ~7;
}

export class ExtRuntime {
  readonly mem: GuestMemory;
  readonly cpu: ARMCPU;
  readonly cache: BlockCache;
  readonly owners = new ModuleOwners();
  readonly table = new MrTable();
  heapTop = EXT_HEAP_ADDR;
  codeBase = EXT_CODE_ADDR;
  codeLen = 0;
  insnBudget = DEFAULT_INSN_BUDGET;
  lastKind: ExtStopKind = ExtStopKind.Return;
  bridgeCalls = 0;
  debugOutput = "";
  onExtCall: ((code: number, out: ExtCallResult) => void) | null = null;

  constructor() {
    this.mem = createExtMemory();
    this.cpu = new ARMCPU(this.mem);
    this.cache = new BlockCache();
    this.cpu.cache = this.cache;
    this.cpu.onBeforeFetch = (cpu) => this.intercept(cpu);
    this.cpu.onSvc = (cpu, immediate) => {
      // ARM semihosting SYS_WRITEC, used by vendor debug putchar stubs.
      if (!cpu.t || immediate !== 0xab || cpu.r[0] !== 3) return false;
      const ch = this.mem.read8(cpu.r[1]);
      this.debugOutput = (this.debugOutput + String.fromCharCode(ch)).slice(-4096);
      return true;
    };
    this.mem.onWrite = (addr, size) => this.onGuestWrite(addr, size);
    this.installBuiltinHandlers();
    this.initTable();
  }

  alloc(size: number): number {
    const n = align8(Math.max(size, 1));
    const addr = this.heapTop >>> 0;
    this.heapTop = (this.heapTop + n) >>> 0;
    return addr;
  }

  allocU32(init = 0): number {
    const addr = this.alloc(4);
    this.mem.write32(addr, init);
    return addr;
  }

  private initTable(): void {
    initTableMemory(this.mem, (n) => {
      const size = dataSlotAllocSize(n);
      const addr = this.alloc(size);
      this.mem.fill(addr, 0, align8(Math.max(size, 1)));
      return addr;
    });
    for (let n = 0; n < EXT_TABLE_COUNT; n++) {
      this.mem.write32(n * 4, this.mem.read32(tableSlotAddr(n)));
    }
  }

  packFilenameAddr(): number {
    return this.mem.read32(tableSlotAddr(PACK_FILENAME_SLOT)) >>> 0;
  }

  /**
   * rxgj `arm_ext_set_pack_table_name`: zero 128 bytes, then
   * `snprintf(dst, 128, "%s", name)`. Reuses the existing table[100] buffer.
   */
  setPackTableName(name: string | null | undefined): void {
    const addr = this.packFilenameAddr();
    if (!addr) return;
    this.mem.fill(addr, 0, MR_MAX_FILENAME_SIZE);
    const src = name ?? "";
    const n = Math.min(src.length, MR_MAX_FILENAME_SIZE - 1);
    for (let i = 0; i < n; i++) this.mem.write8(addr + i, src.charCodeAt(i) & 0xff);
  }

  private installBuiltinHandlers(): void {
    this.table.setHandler(25, (cpu) => this.handleFunctionNew(cpu));
  }

  registerHandler(n: number, handler: (cpu: ARMCPU, mem: GuestMemory, args: Uint32Array) => number): void {
    this.table.setHandler(n, handler);
  }

  addCodeRegion(base: number, len: number): void {
    const b = base >>> 0;
    const n = align2(Math.max(len, 2));
    if (!this.cache.findRegion(b)) this.cache.addRegion(b, n);
  }

  pokeCode(addr: number, data: ArrayLike<number>): void {
    this.mem.load(addr, data);
    this.cache.invalidate(addr >>> 0, data.length);
    this.addCodeRegion(addr, data.length);
  }

  unload(base: number, len: number): void {
    this.cache.invalidate(base >>> 0, len);
    this.owners.nested.splice(
      0,
      this.owners.nested.length,
      ...this.owners.nested.filter((m) => m.fileAddr !== (base >>> 0)),
    );
  }

  private onGuestWrite(addr: number, size: number): void {
    const a = addr >>> 0;
    if (this.cache.findRegion(a)) this.cache.invalidate(a, size);
  }

  load(bytes: Uint8Array, opts: LoadOptions = {}): LoadResult {
    const dest = (opts.dest ?? EXT_CODE_ADDR) >>> 0;
    const image = parseExtImage(bytes);
    const mapped = mapExtImage(this.mem, image, dest);
    this.codeBase = dest;
    this.codeLen = mapped.length;
    this.addCodeRegion(dest, mapped.length);
    this.cache.invalidate(dest, mapped.length);
    if (opts.stage) this.owners.stage(dest, mapped.length);
    if (opts.runLoad === false) {
      return { mapped, ret: MR_SUCCESS, kind: ExtStopKind.Return };
    }
    const result = this.runGuest(mapped.loadAddr, {
      thumb: opts.thumb ? 1 : 0,
      r0: opts.loadCode ?? 0,
    });
    this.ensureKnownRw();
    return { mapped, ret: result.r0, kind: result.kind, ...(result.kind !== ExtStopKind.Return ? { pc: result.pc, detail: result.detail } : {}) };
  }

  ensureKnownRw(len = 256): void {
    for (const ref of [this.owners.wrapper, this.owners.primary, this.owners.active]) {
      if (ref.p && !this.mem.read32(ref.p + AEX_P_ER_RW_OFF)) {
        this.writeP(ref.p, this.alloc(len), len);
      }
    }
  }

  /**
   * Route helper:
   *   code 1 + separate wrapper → wrapper  (wrapper-first)
   *   code 0..5 + primary       → primary
   *   code 2 + timer            → timer
   *   else                      → active || wrapper
   * code 6 / 8 are not in 0..5, so they take active/wrapper.
   */
  routeCall(code: number): { p: number; helper: number } {
    const sep = this.owners.hasSeparateWrapper();
    let p = 0;
    let helper = 0;
    if (code === 1 && sep) {
      p = this.owners.wrapper.p;
      helper = this.owners.wrapper.helper;
    } else if (code >= 0 && code <= 5 && this.owners.primary.p) {
      p = this.owners.primary.p;
      helper = this.owners.primary.helper;
    } else {
      p = this.owners.active.p || this.owners.wrapper.p;
      helper = this.owners.active.helper || this.owners.wrapper.helper;
    }
    if (code === 2 && this.owners.timer.p && this.owners.timer.helper) {
      p = this.owners.timer.p;
      helper = this.owners.timer.helper;
    }
    return { p, helper };
  }

  arm_ext_call(code: number, input?: Uint8Array | null, inputAddr?: number, inputLen?: number): ExtCallResult {
    const { p, helper } = this.routeCall(code);
    if (!p || !helper) {
      const failed: ExtCallResult = {
        kind: ExtStopKind.AbiFault,
        detail: "no registered module helper",
        ret: MR_FAILED,
        r0: MR_FAILED,
        outputAddr: 0,
        outputLen: 0,
        output: new Uint8Array(),
        insnCount: 0,
      };
      this.onExtCall?.(code, failed);
      return failed;
    }
    let inAddr = inputAddr ?? 0;
    let inLen = inputLen ?? (input ? input.length : 0);
    if (input && inputAddr === undefined) {
      inAddr = this.alloc(input.length || 1);
      if (input.length) this.mem.load(inAddr, input);
      inLen = input.length;
    }
    const outp = this.alloc(4);
    const outl = this.alloc(4);
    this.mem.write32(outp, 0);
    this.mem.write32(outl, 0);
    const sp = (stackTop() - 16) >>> 0;
    this.mem.write32(sp, outp);
    this.mem.write32(sp + 4, outl);
    this.mem.write32(sp + 8, 0);
    this.mem.write32(sp + 12, 0);

    const savedR9 = this.cpu.r[9] >>> 0;
    const rw = this.mem.read32(p + AEX_P_ER_RW_OFF);
    this.owners.frames.push({
      p: this.owners.current.p,
      helper: this.owners.current.helper,
      r9: savedR9,
      returnPc: EXT_STOP_ADDR,
    });
    this.owners.current = { p, helper };
    const result = this.runGuest(helper, {
      thumb: helper & 1,
      r0: p,
      r1: code >>> 0,
      r2: inAddr,
      r3: inLen,
      r9: rw,
      sp,
      lr: EXT_STOP_ADDR,
    });
    this.owners.current = { p: 0, helper: 0 };
    const frame = this.owners.frames.pop();
    if (frame) this.cpu.r[9] = frame.r9;
    this.ensureKnownRw();

    const outLen = this.mem.read32(outl) >>> 0;
    const outPtr = this.mem.read32(outp) >>> 0;
    let output = new Uint8Array();
    if (outPtr && outLen && outLen < 0x10_0000) {
      try {
        output = new Uint8Array(this.mem.slice(outPtr, outLen));
      } catch {
        output = new Uint8Array();
      }
    }
    const out: ExtCallResult = {
      ...result,
      outputAddr: outPtr,
      outputLen: outLen,
      output,
    };
    this.onExtCall?.(code, out);
    return out;
  }

  runGuest(
    start: number,
    regs: {
      thumb?: number;
      r0?: number;
      r1?: number;
      r2?: number;
      r3?: number;
      r9?: number;
      sp?: number;
      lr?: number;
    } = {},
  ): ExtCallResult {
    const thumb = (regs.thumb ?? (start & 1)) & 1;
    const pc = (start & ~1) >>> 0;
    this.cpu.reset(pc, thumb);
    if (regs.r0 !== undefined) this.cpu.r[0] = regs.r0 >>> 0;
    if (regs.r1 !== undefined) this.cpu.r[1] = regs.r1 >>> 0;
    if (regs.r2 !== undefined) this.cpu.r[2] = regs.r2 >>> 0;
    if (regs.r3 !== undefined) this.cpu.r[3] = regs.r3 >>> 0;
    if (regs.r9 !== undefined) this.cpu.r[9] = regs.r9 >>> 0;
    this.cpu.r[13] = (regs.sp ?? stackTop() - 16) >>> 0;
    this.cpu.r[14] = (regs.lr ?? EXT_STOP_ADDR) >>> 0;
    this.cpu.r[15] = pc;
    this.cpu.t = thumb;
    this.lastKind = ExtStopKind.Return;
    const startCount = this.cpu.insnCount;
    const budget = Math.min(Math.max(this.insnBudget | 0, 1), MAX_INSN_BUDGET);
    try {
      run(this.cpu, budget);
      this.lastKind = ExtStopKind.AbiFault;
      return this.finish(ExtStopKind.AbiFault, "budget exceeded");
    } catch (e) {
      if (e instanceof ExtStopped) {
        this.lastKind = e.kind;
        return this.finish(e.kind);
      }
      if (e instanceof ExtFault) {
        this.lastKind = e.kind;
        return this.finish(e.kind, e.message);
      }
      if (e instanceof UnsupportedInsn) {
        this.lastKind = ExtStopKind.Unsupported;
        return this.finish(ExtStopKind.Unsupported, e.message);
      }
      if (e instanceof MemoryFault) {
        this.lastKind = ExtStopKind.Unmapped;
        return this.finish(ExtStopKind.Unmapped, e.message);
      }
      throw e;
    } finally {
      void startCount;
    }
  }

  private finish(kind: ExtStopKind, detail?: string): ExtCallResult {
    return {
      kind,
      ...(kind !== ExtStopKind.Return ? { pc: this.cpu.r[15] >>> 0, detail } : {}),
      ret: this.cpu.r[0] >>> 0,
      r0: this.cpu.r[0] >>> 0,
      outputAddr: 0,
      outputLen: 0,
      output: new Uint8Array(),
      insnCount: this.cpu.insnCount,
    };
  }

  private intercept(cpu: ARMCPU): boolean {
    const pc = cpu.r[15] >>> 0;
    if ((pc & ~1) === EXT_STOP_ADDR) {
      throw new ExtStopped(ExtStopKind.Return, pc);
    }
    if (pc < EXT_TABLE_COUNT * 4 && (pc & 3) === 0) {
      this.bridgeCalls++;
      this.table.dispatch(cpu, this.mem, (EXT_TABLE_ADDR + pc) >>> 0);
      return true;
    }
    if (pc >= EXT_TABLE_ADDR && pc < EXT_TABLE_ADDR + EXT_TABLE_COUNT * 4) {
      this.bridgeCalls++;
      this.table.dispatch(cpu, this.mem, pc);
      return true;
    }
    this.maybeSwitchOwner(cpu, pc);
    return false;
  }

  private maybeSwitchOwner(cpu: ARMCPU, pc: number): void {
    const hit = this.owners.findByHelper(pc);
    if (!hit) {
      this.maybeReturnOwner(cpu, pc);
      return;
    }
    const helper = "helper" in hit ? hit.helper : 0;
    const p = "p" in hit ? hit.p : 0;
    if ((this.owners.current.helper & ~1) === (helper & ~1)) return;
    if ((helper & ~1) !== (pc & ~1)) return;
    this.owners.frames.push({
      p: this.owners.current.p,
      helper: this.owners.current.helper,
      r9: cpu.r[9] >>> 0,
      returnPc: cpu.r[14] >>> 0,
    });
    this.owners.current = { p, helper };
    if (p) cpu.r[9] = this.mem.read32(p + AEX_P_ER_RW_OFF);
  }

  private maybeReturnOwner(cpu: ARMCPU, pc: number): void {
    const top = this.owners.frames[this.owners.frames.length - 1];
    if (!top) return;
    if ((pc & ~1) !== (top.returnPc & ~1)) return;
    this.owners.frames.pop();
    cpu.r[9] = top.r9;
    this.owners.current = { p: top.p, helper: top.helper };
  }

  private handleFunctionNew(cpu: ARMCPU): number {
    const helper = cpu.r[0] >>> 0;
    const reqLen = cpu.r[1] >>> 0;
    const lr = cpu.r[14] >>> 0;
    const range = this.owners.fileRangeForLr(lr);
    const nested = !!range;
    let pLen = reqLen || AEX_P_SIZE;
    if (pLen < AEX_P_SIZE) pLen = AEX_P_SIZE;
    const p = this.alloc(pLen);
    this.mem.fill(p, 0, pLen);
    if (nested && range) {
      this.mem.write32(range.fileAddr + 4, p);
      this.owners.active = { p, helper };
      this.owners.recordNested(range.fileAddr, range.fileLen, p, helper);
      if (!this.owners.primary.helper) {
        this.owners.primary = { p, helper };
      }
    } else {
      this.owners.wrapper = { p, helper };
      this.owners.active = { p, helper };
      this.mem.write32(this.codeBase + 4, p);
    }
    this.ensureKnownRw();
    return p ? MR_SUCCESS : MR_FAILED;
  }

  writeP(p: number, rw: number, rwLen: number): void {
    this.mem.write32(p + AEX_P_ER_RW_OFF, rw);
    this.mem.write32(p + 4, rwLen);
  }

  installModule(role: "wrapper" | "primary" | "active" | "timer" | "screen", p: number, helper: number, rw?: number, rwLen = 64): void {
    if (rw !== undefined) this.writeP(p, rw, rwLen);
    this.owners[role] = { p, helper };
    if (role === "wrapper" && !this.owners.active.helper) this.owners.active = { p, helper };
  }
}

export function isDataSlot(n: number): boolean {
  return DATA_SLOTS.has(n);
}

export { EXT_STACK_ADDR };
