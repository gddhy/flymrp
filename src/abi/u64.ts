/** 32/64-bit integer helpers that stay exact on Firefox 48 (no BigInt). */

export function umul64(a: number, b: number): [number, number] {
  a >>>= 0;
  b >>>= 0;
  const a0 = a & 0xffff, a1 = a >>> 16, b0 = b & 0xffff, b1 = b >>> 16;
  const p0 = a0 * b0, p1 = a0 * b1, p2 = a1 * b0, p3 = a1 * b1;
  const mid = (p0 >>> 16) + (p1 & 0xffff) + (p2 & 0xffff);
  return [
    ((p0 & 0xffff) | (mid << 16)) >>> 0,
    (p3 + (p1 >>> 16) + (p2 >>> 16) + (mid >>> 16)) >>> 0,
  ];
}

export function smul64(a: number, b: number): [number, number] {
  const ua = a >>> 0, ub = b >>> 0;
  const pair = umul64(ua, ub);
  if (a < 0) pair[1] = (pair[1] - ub) >>> 0;
  if (b < 0) pair[1] = (pair[1] - ua) >>> 0;
  return pair;
}

export function add64(lo: number, hi: number, addLo: number, addHi: number): [number, number] {
  const sumLo = (lo + addLo) >>> 0;
  return [sumLo, (hi + addHi + (sumLo < (lo >>> 0) ? 1 : 0)) >>> 0];
}

export function u64Hex(hi: number, lo: number): string {
  hi >>>= 0;
  lo >>>= 0;
  if (!hi) return lo.toString(16);
  const low = lo.toString(16);
  return hi.toString(16) + (low.length < 8 ? "00000000".slice(low.length) + low : low);
}

export function u64Dec(hi: number, lo: number): string {
  hi >>>= 0;
  lo >>>= 0;
  if (hi < 0x200000) return String(hi * 4294967296 + lo);
  const digits: number[] = [];
  while (hi || lo) {
    const qh = Math.floor(hi / 10);
    const t = (hi - qh * 10) * 4294967296 + lo;
    const ql = Math.floor(t / 10);
    digits.push(t - ql * 10);
    hi = qh;
    lo = ql >>> 0;
  }
  let s = "";
  for (let i = digits.length - 1; i >= 0; i--) s += digits[i];
  return s || "0";
}

export function i64Dec(hi: number, lo: number): string {
  if ((hi >>> 31) === 0) return u64Dec(hi, lo);
  const nlo = (~lo + 1) >>> 0;
  return "-" + u64Dec((~hi + (nlo === 0 ? 1 : 0)) >>> 0, nlo);
}

export function formatU64(hi: number, lo: number, spec: string): string {
  if (spec === "x" || spec === "X") {
    const hex = u64Hex(hi, lo);
    return spec === "X" ? hex.toUpperCase() : hex;
  }
  return spec === "d" || spec === "i" ? i64Dec(hi, lo) : u64Dec(hi, lo);
}
