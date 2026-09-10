import type { GuestMemory } from "./memory.ts";
import { decodeArm } from "./decode-arm.ts";
import { decodeThumb16, isThumb32Prefix } from "./decode-thumb16.ts";
import { decodeThumb32 } from "./decode-thumb32.ts";

export function insnSize(w2: number): number {
  const s = (w2 >>> 8) & 0xff;
  return s === 0 ? 4 : s;
}

/** Fetch + decode one insn at `pc`. Returns byte size (2 or 4). */
export function decodeAt(
  mem: GuestMemory,
  pc: number,
  thumb: number,
  out: Uint32Array,
  idx: number,
): number {
  let size: number;
  if (thumb) {
    const hw = mem.read16(pc);
    if (isThumb32Prefix(hw)) {
      decodeThumb32(hw, mem.read16((pc + 2) >>> 0), out, idx);
      size = 4;
    } else {
      decodeThumb16(hw, out, idx);
      size = 2;
    }
  } else {
    decodeArm(mem.read32(pc), out, idx);
    size = 4;
  }
  out[idx + 2] = ((out[idx + 2] & 0xffff00ff) | (size << 8)) >>> 0;
  return size;
}
