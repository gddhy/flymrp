import type { ARMCPU } from "./cpu.ts";
import { decodeAt, insnSize } from "./decode.ts";
import { execPacked, step } from "./interp.ts";
import { Op } from "./opcodes.ts";

const MAX_INSNS = 16;
const POOL_CAP = 4096;

export type BasicBlock = {
  guestPC: number;
  endPC: number;
  count: number;
  packed: Uint32Array;
  thumb: number;
  /** Copied from the region at decode time; stale if region.generation differs. */
  generation: number;
};

export type ExecRegion = {
  base: number;
  len: number;
  generation: number;
  /** ARM: index = (pc-base) >>> 2 */
  blockIdArm: Uint32Array;
  /** Thumb: index = (pc-base) >>> 1  — 2-byte slots, separate from ARM */
  blockIdThumb: Uint32Array;
};

const TERMINATORS = new Set<number>([
  Op.B,
  Op.BL,
  Op.BX,
  Op.BLX,
  Op.CBZ,
  Op.CBNZ,
  Op.SVC,
  Op.BKPT,
  Op.UNDEF,
]);

function endsBlock(w0: number): boolean {
  const op = w0 & 0xff;
  if (TERMINATORS.has(op)) return true;
  const rd = (w0 >>> 12) & 0xf;
  if (
    rd === 15 &&
    (op <= Op.MVN ||
      op === Op.LDR ||
      op === Op.LDRB ||
      op === Op.LDRH ||
      op === Op.LDRSB ||
      op === Op.LDRSH)
  ) {
    return true;
  }
  return false;
}

export class BlockCache {
  readonly regions: ExecRegion[] = [];
  lastRegion: ExecRegion | null = null;
  readonly pool: Array<BasicBlock | null> = [null];
  hits = 0;
  misses = 0;

  addRegion(base: number, len: number): ExecRegion {
    base >>>= 0;
    len >>>= 0;
    if ((base & 1) !== 0 || (len & 1) !== 0) {
      throw new RangeError("ExecRegion must be 2-byte aligned");
    }
    const region: ExecRegion = {
      base,
      len,
      generation: 1,
      blockIdArm: new Uint32Array(len >>> 2),
      blockIdThumb: new Uint32Array(len >>> 1),
    };
    this.regions.push(region);
    this.lastRegion = region;
    return region;
  }

  findRegion(pc: number): ExecRegion | null {
    const a = pc >>> 0;
    const last = this.lastRegion;
    if (last && (a - last.base) >>> 0 < last.len) return last;
    for (let i = 0; i < this.regions.length; i++) {
      const r = this.regions[i]!;
      if ((a - r.base) >>> 0 < r.len) {
        this.lastRegion = r;
        return r;
      }
    }
    return null;
  }

  private slot(region: ExecRegion, pc: number, thumb: number): Uint32Array | null {
    const off = (pc - region.base) >>> 0;
    if (thumb) {
      if (off >= region.len || (pc & 1) !== 0) return null;
      return region.blockIdThumb;
    }
    if (off >= region.len || (pc & 3) !== 0) return null;
    return region.blockIdArm;
  }

  private index(pc: number, base: number, thumb: number): number {
    return thumb ? (pc - base) >>> 1 : (pc - base) >>> 2;
  }

  lookupId(pc: number, thumb: number): number {
    const region = this.findRegion(pc);
    if (!region) return 0;
    const table = this.slot(region, pc, thumb);
    if (!table) return 0;
    return table[this.index(pc, region.base, thumb)] ?? 0;
  }

  getOrDecode(cpu: ARMCPU): BasicBlock {
    const pc = cpu.r[15] >>> 0;
    const thumb = cpu.t;
    const region = this.findRegion(pc);
    const id = this.lookupId(pc, thumb);
    if (id !== 0) {
      const b = this.pool[id];
      if (
        b &&
        b.guestPC === pc &&
        b.thumb === thumb &&
        (!region || b.generation === region.generation)
      ) {
        this.hits++;
        return b;
      }
    }
    this.misses++;
    return this.decodeFill(cpu, pc, thumb);
  }

  private decodeFill(cpu: ARMCPU, pc: number, thumb: number): BasicBlock {
    const words: number[] = [];
    let cur = pc;
    let count = 0;
    const tmp = new Uint32Array(3);
    while (count < MAX_INSNS) {
      const size = decodeAt(cpu.mem, cur, thumb, tmp, 0);
      words.push(tmp[0]!, tmp[1]!, tmp[2]!);
      count++;
      const op = tmp[0]! & 0xff;
      const rd = (tmp[0]! >>> 12) & 0xf;
      const list = tmp[1]!;
      const stop =
        endsBlock(tmp[0]!) ||
        (op === Op.LDM && (list & (1 << 15)) !== 0) ||
        (rd === 15 && op === Op.LDR);
      cur = (cur + size) >>> 0;
      if (stop) break;
    }
    const region = this.findRegion(pc);
    const block: BasicBlock = {
      guestPC: pc,
      endPC: cur,
      count,
      packed: Uint32Array.from(words),
      thumb,
      generation: region ? region.generation : 0,
    };
    if (region && this.pool.length < POOL_CAP) {
      const id = this.pool.length;
      this.pool.push(block);
      const table = this.slot(region, pc, thumb);
      if (table) table[this.index(pc, region.base, thumb)] = id;
    }
    return block;
  }

  runBlock(cpu: ARMCPU, budget: number): void {
    if (cpu.onBeforeFetch && cpu.onBeforeFetch(cpu)) return;
    if (cpu.itState !== 0 || budget <= 0) {
      step(cpu);
      return;
    }
    const block = this.getOrDecode(cpu);
    let instPC = cpu.r[15] >>> 0;
    if (instPC !== block.guestPC || cpu.t !== block.thumb) {
      step(cpu);
      return;
    }
    const packed = block.packed;
    for (let i = 0; i < block.count && budget > 0; i++) {
      const o = i * 3;
      execPacked(cpu, instPC, packed[o]!, packed[o + 1]!, packed[o + 2]!);
      cpu.insnCount++;
      budget--;
      if (cpu.branched) return;
      instPC = (instPC + insnSize(packed[o + 2]!)) >>> 0;
    }
  }

  invalidate(base: number, len: number): void {
    const end = (base + len) >>> 0;
    for (const r of this.regions) {
      const a = Math.max(r.base, base);
      const b = Math.min(r.base + r.len, end);
      if (a >= b) continue;
      r.generation = (r.generation + 1) >>> 0 || 1;
      const arm0 = (a - r.base) >>> 2;
      const arm1 = (b - r.base + 3) >>> 2;
      r.blockIdArm.fill(0, arm0, Math.min(arm1, r.blockIdArm.length));
      const t0 = (a - r.base) >>> 1;
      const t1 = (b - r.base + 1) >>> 1;
      r.blockIdThumb.fill(0, t0, Math.min(t1, r.blockIdThumb.length));
    }
  }
}
