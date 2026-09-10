/** NZCV helpers and condition codes. [HOT] */

export function addFlags(a: number, b: number, cin: number): {
  result: number;
  c: number;
  v: number;
} {
  const ua = a >>> 0;
  const ub = b >>> 0;
  const sum = ua + ub + (cin & 1);
  const result = sum >>> 0;
  const c = sum > 0xffffffff ? 1 : 0;
  const sa = ua | 0;
  const sb = ub | 0;
  const sr = result | 0;
  const v = (~(sa ^ sb) & (sa ^ sr)) < 0 ? 1 : 0;
  return { result, c, v };
}

export function subFlags(a: number, b: number, cin: number): {
  result: number;
  c: number;
  v: number;
} {
  // cin=1 means no extra borrow (ADC-style): a - b - (1-cin)
  const ua = a >>> 0;
  const ub = b >>> 0;
  const borrowIn = cin & 1 ? 0 : 1;
  const raw = ua - ub - borrowIn;
  const result = raw >>> 0;
  const c = raw >= 0 ? 1 : 0;
  const sa = ua | 0;
  const sb = ub | 0;
  const sr = result | 0;
  const v = ((sa ^ sb) & (sa ^ sr)) < 0 ? 1 : 0;
  return { result, c, v };
}

export function nz(result: number): { n: number; z: number } {
  const r = result >>> 0;
  return { n: r >>> 31, z: r === 0 ? 1 : 0 };
}

export function conditionPassed(
  cond: number,
  n: number,
  z: number,
  c: number,
  v: number,
): boolean {
  switch (cond) {
    case 0:
      return z === 1;
    case 1:
      return z === 0;
    case 2:
      return c === 1;
    case 3:
      return c === 0;
    case 4:
      return n === 1;
    case 5:
      return n === 0;
    case 6:
      return v === 1;
    case 7:
      return v === 0;
    case 8:
      return c === 1 && z === 0;
    case 9:
      return c === 0 || z === 1;
    case 10:
      return n === v;
    case 11:
      return n !== v;
    case 12:
      return z === 0 && n === v;
    case 13:
      return z === 1 || n !== v;
    case 14:
      return true;
    default:
      return false;
  }
}
