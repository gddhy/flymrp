/**
 * Guest-aware sprintf_ subset for table[17].
 *
 * Only literal bytes and `%d` (guest ARM int32). Not a libc wrapper.
 * Does not construct a host C argument list. Does not call host sprintf.
 *
 * Return: number of bytes written excluding the trailing NUL
 * (mpaland `_vsnprintf` / `sprintf_`).
 */
import { UnknownAbiError } from "../err/errors.ts";
import type { GuestMemory } from "../hot/memory.ts";

/** Bound on format walk. Unterminated format is an ABI error, not silent truncate. */
export const SPRINTF_FORMAT_MAX = 256;

export type SprintfVararg = (index: number) => number;

function int32Decimal(word: number): string {
  const n = word | 0;
  if (n === 0) return "0";
  return n.toString(10);
}

function unsupported(spec: string): never {
  throw new UnknownAbiError(`unsupported sprintf format ${spec}`, {
    family: "sprintf_",
    code: spec,
    caller: "ext",
  });
}

/**
 * `int sprintf_(char *buffer, const char *format, ...)` guest subset.
 * `nextVararg` is called only when a `%d` is consumed. Index 0 is R2.
 */
export function guestSprintf(
  mem: GuestMemory,
  buffer: number,
  format: number,
  nextVararg: SprintfVararg,
): number {
  const dst = buffer >>> 0;
  const fmt = format >>> 0;
  let out = 0;
  let vi = 0;
  for (let i = 0; i < SPRINTF_FORMAT_MAX; i++) {
    const ch = mem.read8((fmt + i) >>> 0) & 0xff;
    if (ch === 0) {
      mem.write8((dst + out) >>> 0, 0);
      return out;
    }
    if (ch !== 0x25) {
      mem.write8((dst + out) >>> 0, ch);
      out++;
      continue;
    }
    i++;
    if (i >= SPRINTF_FORMAT_MAX) {
      throw new UnknownAbiError("unterminated sprintf format", {
        family: "sprintf_",
        code: "%",
        caller: "ext",
      });
    }
    const spec = mem.read8((fmt + i) >>> 0) & 0xff;
    if (spec === 0) unsupported("%");
    if (spec !== 0x64) {
      unsupported(`%${spec >= 0x20 && spec < 0x7f ? String.fromCharCode(spec) : spec.toString(16)}`);
    }
    const digits = int32Decimal(nextVararg(vi++));
    for (let d = 0; d < digits.length; d++) {
      mem.write8((dst + out) >>> 0, digits.charCodeAt(d));
      out++;
    }
  }
  throw new UnknownAbiError("unterminated sprintf format", {
    family: "sprintf_",
    code: "format",
    caller: "ext",
  });
}

/**
 * Guest-aware `mr_printf` subset: literals, `%d`, `%s`.
 * `%s` reads a guest C string. Does not call host printf/sprintf.
 * Returns the formatted bytes (excluding NUL), matching mpaland length.
 */
export function guestPrintf(
  mem: GuestMemory,
  format: number,
  nextVararg: SprintfVararg,
  maxOut = 1024,
): string {
  const fmt = format >>> 0;
  let out = "";
  let vi = 0;
  for (let i = 0; i < SPRINTF_FORMAT_MAX; i++) {
    const ch = mem.read8((fmt + i) >>> 0) & 0xff;
    if (ch === 0) return out;
    if (ch !== 0x25) {
      out += String.fromCharCode(ch);
      if (out.length >= maxOut) return out.slice(0, maxOut);
      continue;
    }
    i++;
    if (i >= SPRINTF_FORMAT_MAX) unsupported("%");
    let width = 0;
    let spec = mem.read8((fmt + i) >>> 0) & 0xff;
    while (spec >= 0x30 && spec <= 0x39) {
      width = width * 10 + (spec - 0x30);
      i++;
      if (i >= SPRINTF_FORMAT_MAX) unsupported("%");
      spec = mem.read8((fmt + i) >>> 0) & 0xff;
    }
    if (spec === 0) unsupported("%");
    let piece = "";
    if (spec === 0x64) {
      piece = int32Decimal(nextVararg(vi++));
    } else if (spec === 0x73) {
      const p = nextVararg(vi++) >>> 0;
      if (p) {
        for (let k = 0; k < 256; k++) {
          const b = mem.read8((p + k) >>> 0) & 0xff;
          if (b === 0) break;
          piece += String.fromCharCode(b);
        }
      }
    } else {
      unsupported(`%${spec >= 0x20 && spec < 0x7f ? String.fromCharCode(spec) : spec.toString(16)}`);
    }
    if (width > piece.length) piece = piece.padStart(width, " ");
    out += piece;
    if (out.length >= maxOut) return out.slice(0, maxOut);
  }
  throw new UnknownAbiError("unterminated sprintf format", {
    family: "mr_printf",
    code: "format",
    caller: "ext",
  });
}

/** AAPCS vararg #n for `mr_printf`: 0→R1, 1→R2, 2→R3, 3+→stack. */
export function aapcsPrintfVararg(args: Uint32Array, index: number): number {
  const slot = index + 1;
  if (slot < 0 || slot >= args.length) {
    throw new UnknownAbiError(`printf vararg ${index} out of AAPCS window`, {
      family: "mr_printf",
      code: index,
      caller: "ext",
    });
  }
  return args[slot]! >>> 0;
}

/** AAPCS vararg #n: 0→R2, 1→R3, 2+→[SP+(n-2)*4] via `readAapcs` slots 2..7. */
export function aapcsSprintfVararg(args: Uint32Array, index: number): number {
  const slot = index + 2;
  if (slot < 0 || slot >= args.length) {
    throw new UnknownAbiError(`sprintf vararg ${index} out of AAPCS window`, {
      family: "sprintf_",
      code: index,
      caller: "ext",
    });
  }
  return args[slot]! >>> 0;
}
