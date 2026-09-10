import type { GuestMemory } from "./memory.ts";
import type { BlockCache } from "./cache.ts";

/**
 * Architectural CPU state.
 * r[] is the authority. n/z/c/v/t are the hot-path flags.
 * [HOT]
 */
export class ARMCPU {
  readonly r: Uint32Array = new Uint32Array(16);
  n = 0;
  z = 0;
  c = 0;
  v = 0;
  t = 0;
  /** Privileged/unused CPSR bits we still preserve for MRS/MSR and Unicorn diffs. */
  cpsrExtra = 0x0000_0010;
  /** Thumb ITSTATE: bits[7:5] cond high, [4:0] mask (QEMU layout). 0 = inactive. */
  itState = 0;
  mem: GuestMemory;
  cache: BlockCache | null = null;
  /**
   * Optional fetch intercept (table slot, EXT stop). Return true if the
   * handler consumed this fetch (PC already updated). Not used by Stage 3.
   */
  onBeforeFetch: ((cpu: ARMCPU) => boolean) | null = null;
  /** Optional platform SVC ABI; false retains the architectural trap. */
  onSvc: ((cpu: ARMCPU, immediate: number) => boolean) | null = null;
  /** Set when the last instruction was a taken control-flow write to R15. */
  branched = 0;
  /** Set when EXT hits the stop address; `run()` exits without throwing. */
  halted = 0;
  insnCount = 0;

  constructor(mem: GuestMemory) {
    this.mem = mem;
    this.r[15] = 0;
  }

  get cpsr(): number {
    let w = (this.cpsrExtra & ~0xf000_0020) >>> 0;
    if (this.n) w |= 0x8000_0000;
    if (this.z) w |= 0x4000_0000;
    if (this.c) w |= 0x2000_0000;
    if (this.v) w |= 0x1000_0000;
    if (this.t) w |= 0x20;
    const it = this.itState & 0xff;
    w = (w & ~0x0600_fc00) >>> 0;
    w |= (it & 0xfc) << 8;
    w |= (it & 0x03) << 25;
    return w >>> 0;
  }

  set cpsr(value: number) {
    const w = value >>> 0;
    this.n = (w >>> 31) & 1;
    this.z = (w >>> 30) & 1;
    this.c = (w >>> 29) & 1;
    this.v = (w >>> 28) & 1;
    this.t = (w >>> 5) & 1;
    this.itState = ((w >>> 8) & 0xfc) | ((w >>> 25) & 3);
    this.cpsrExtra = (w & ~0xf000_0020 & ~0x0600_fc00) >>> 0;
  }

  reset(pc = 0, thumb = 0): void {
    this.r.fill(0);
    this.n = this.z = this.c = this.v = 0;
    this.t = thumb & 1;
    this.itState = 0;
    this.cpsrExtra = 0x0000_0010;
    this.r[15] = pc >>> 0;
    this.branched = 0;
    this.halted = 0;
    this.insnCount = 0;
  }

  snapshotRegs(): Uint32Array {
    return this.r.slice();
  }

  loadRegs(regs: ArrayLike<number>): void {
    for (let i = 0; i < 16; i++) this.r[i] = regs[i] >>> 0;
  }
}

export class UnsupportedInsn extends Error {
  readonly pc: number;
  readonly word: number;
  readonly thumb: number;

  constructor(pc: number, word: number, thumb: number, detail?: string) {
    super(
      `unsupported ${thumb ? "Thumb" : "ARM"} insn at 0x${(pc >>> 0).toString(16)} ` +
        `word=0x${(word >>> 0).toString(16)}${detail ? ` (${detail})` : ""}`,
    );
    this.name = "UnsupportedInsn";
    this.pc = pc >>> 0;
    this.word = word >>> 0;
    this.thumb = thumb;
    if (typeof Object.setPrototypeOf === "function") Object.setPrototypeOf(this, UnsupportedInsn.prototype);
  }
}

export class CpuTrap extends Error {
  readonly pc: number;
  readonly kind: string;
  readonly imm: number;

  constructor(kind: string, pc: number, imm = 0) {
    super(`${kind} at 0x${(pc >>> 0).toString(16)} imm=0x${(imm >>> 0).toString(16)}`);
    this.name = "CpuTrap";
    this.kind = kind;
    this.pc = pc >>> 0;
    this.imm = imm >>> 0;
  }
}
