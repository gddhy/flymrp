/**
 * Guest-aware sprintf_ subset for table[17].
 *
 * Integer, string and character formats with field widths; values come from guest AAPCS arguments.
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
 * `nextVararg` is called for each conversion except `%%`. Index 0 is R2.
 */
export function guestSprintf(
  mem: GuestMemory,
  buffer: number,
  format: number,
  nextVararg: SprintfVararg,
): number {
  const dst = buffer >>> 0;
  let fmt = "";
  for (let i = 0; i < SPRINTF_FORMAT_MAX; i++) {
    const b = mem.read8((format + i) >>> 0);
    if (!b) break;
    fmt += String.fromCharCode(b);
    if (i === SPRINTF_FORMAT_MAX - 1) unsupported("unterminated format");
  }
  let out = 0, vi = 0;
  const write = (piece: string) => {
    for (let i = 0; i < piece.length; i++) mem.write8((dst + out++) >>> 0, piece.charCodeAt(i));
  };
  for (let i = 0; i < fmt.length;) {
    if (fmt[i] !== "%") { write(fmt[i++]); continue; }
    const match = /^%([0-]?)(\d{0,4})(l{0,2})([diuxXsc%])/.exec(fmt.slice(i));
    if (!match) unsupported(fmt.slice(i, i + 2));
    i += match[0].length;
    const [, flag, widthText, length, spec] = match;
    // ARM's ILP32 long is one word. AAPCS long long is an aligned pair;
    // sprintf's first vararg is R2, so even vararg indices are aligned.
    if (length && !"diuxX".includes(spec)) unsupported(match[0]);
    const width = Number(widthText || 0);
    if (width > 4096) unsupported("width too large");
    if (spec === "%") { write("%"); continue; }
    if (length === "ll") vi = (vi + 1) & ~1;
    const value = nextVararg(vi++) >>> 0;
    const wide = length === "ll" ? (BigInt(nextVararg(vi++) >>> 0) << 32n) | BigInt(value) : null;
    let piece = "";
    if (wide !== null) {
      piece = (spec === "d" || spec === "i" ? BigInt.asIntN(64, wide) : wide).toString(spec === "x" || spec === "X" ? 16 : 10);
    } else if (spec === "s") {
      if (value) {
        for (let j = 0; ; j++) {
          const b = mem.read8((value + j) >>> 0);
          if (!b) break;
          if (j >= 65536) unsupported("unterminated string");
          piece += String.fromCharCode(b);
        }
      } else piece = "(null)";
    } else if (spec === "c") piece = String.fromCharCode(value & 255);
    else if (spec === "d" || spec === "i") piece = String(value | 0);
    else if (spec === "u") piece = String(value);
    else piece = value.toString(16);
    if (spec === "X") piece = piece.toUpperCase();
    if (flag === "-") piece = piece.padEnd(width, " ");
    else if (flag === "0" && spec !== "s" && spec !== "c") {
      piece = piece.startsWith("-") ? "-" + piece.slice(1).padStart(Math.max(0, width - 1), "0") : piece.padStart(width, "0");
    } else piece = piece.padStart(width, " ");
    write(piece);
  }
  mem.write8((dst + out) >>> 0, 0);
  return out;
}

/**
 * Guest-aware `mr_printf`: integer, string, character, and percent conversions.
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
    let zeroPad = false;
    let spec = mem.read8((fmt + i) >>> 0) & 0xff;
    zeroPad = spec === 0x30;
    while (spec >= 0x30 && spec <= 0x39) {
      width = width * 10 + (spec - 0x30);
      i++;
      if (i >= SPRINTF_FORMAT_MAX) unsupported("%");
      spec = mem.read8((fmt + i) >>> 0) & 0xff;
    }
    if (width > 4096) unsupported("width too large");
    if (spec === 0) unsupported("%");
    let wide = false;
    if (spec === 0x6c) {
      spec = mem.read8((fmt + ++i) >>> 0) & 0xff;
      if (spec === 0x6c) { wide = true; spec = mem.read8((fmt + ++i) >>> 0) & 0xff; }
      if (![0x64, 0x69, 0x75, 0x78, 0x58].includes(spec)) unsupported("%l" + String.fromCharCode(spec));
    }
    let piece = "";
    if (wide) {
      // printf's first vararg is R1: skip an odd register/stack word.
      vi |= 1;
      const lo = nextVararg(vi++) >>> 0, hi = nextVararg(vi++) >>> 0;
      const value = (BigInt(hi) << 32n) | BigInt(lo);
      piece = (spec === 0x64 || spec === 0x69 ? BigInt.asIntN(64, value) : value).toString(spec === 0x78 || spec === 0x58 ? 16 : 10);
      if (spec === 0x58) piece = piece.toUpperCase();
    } else if (spec === 0x25) {
      piece = "%";
    } else if (spec === 0x75 || spec === 0x78 || spec === 0x58) {
      piece = (nextVararg(vi++) >>> 0).toString(spec === 0x75 ? 10 : 16);
      if (spec === 0x58) piece = piece.toUpperCase();
    } else if (spec === 0x63) {
      piece = String.fromCharCode(nextVararg(vi++) & 255);
    } else if (spec === 0x64 || spec === 0x69) {
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
    if (width > piece.length) {
      const pad = zeroPad && ![0x73, 0x63, 0x25].includes(spec) ? "0" : " ";
      piece = pad === "0" && piece.startsWith("-")
        ? "-" + piece.slice(1).padStart(width - 1, pad) : piece.padStart(width, pad);
    }
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
export function aapcsSprintfVararg(args: Uint32Array, index: number, mem?: GuestMemory, sp?: number): number {
  const slot = index + 2;
  if (slot >= args.length && mem && sp !== undefined && index >= 2) {
    return mem.read32((sp + (index - 2) * 4) >>> 0) >>> 0;
  }
  if (slot < 0 || slot >= args.length) {
    throw new UnknownAbiError(`sprintf vararg ${index} out of AAPCS window`, {
      family: "sprintf_",
      code: index,
      caller: "ext",
    });
  }
  return args[slot]! >>> 0;
}
