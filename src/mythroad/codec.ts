import { MR_FAILED } from "./constants.ts";

/** rxgj `mr_base64.c` — swapped alphabet, not RFC 4648. */
export function mrEncode(input: Uint8Array): Uint8Array | null {
  const len = input.length;
  const x = (len / 3) | 0;
  const y = len % 3;
  const out = new Uint8Array(x * 4 + (y ? 4 : 0) + 1);
  let i = 0;
  let j = 0;
  for (let z = 0; z < x; z++) {
    out[i] = enc(input[j]! >> 2);
    out[i + 1] = enc(((input[j]! & 0x03) << 4) | (input[j + 1]! >> 4));
    out[i + 2] = enc(((input[j + 1]! & 0x0f) << 2) | (input[j + 2]! >> 6));
    out[i + 3] = enc(input[j + 2]! & 0x3f);
    if ((out[i]! | out[i + 1]! | out[i + 2]! | out[i + 3]!) === 0xff) return null;
    i += 4;
    j += 3;
  }
  if (y !== 0) {
    const buf = [0, 0, 0];
    for (let z = 0; z < y; z++) buf[z] = input[j + z]!;
    out[i] = enc(buf[0]! >> 2);
    out[i + 1] = enc(((buf[0]! & 0x03) << 4) | (buf[1]! >> 4));
    out[i + 2] = enc(((buf[1]! & 0x0f) << 2) | (buf[2]! >> 6));
    out[i + 3] = enc(buf[2]! & 0x3f);
    if ((out[i]! | out[i + 1]! | out[i + 2]! | out[i + 3]!) === 0xff) return null;
    i += 4;
    for (let z = 0; z < 3 - y; z++) out[i - z - 1] = 0x3d;
  }
  return out.subarray(0, i);
}

export function mrDecode(input: Uint8Array): Uint8Array | null {
  const len = input.length;
  if (len === 0) return new Uint8Array(0);
  if (len < 4) return null;
  const x = ((len - 4) / 4) | 0;
  const out = new Uint8Array(x * 3 + 3);
  let i = 0;
  let j = 0;
  for (let z = 0; z < x; z++) {
    const a = [dec(input[j]!), dec(input[j + 1]!), dec(input[j + 2]!), dec(input[j + 3]!)];
    if (a[0] === 0xff || a[1] === 0xff || a[2] === 0xff || a[3] === 0xff) return null;
    out[i] = (a[0]! << 2) | ((a[1]! & 0x30) >> 4);
    out[i + 1] = ((a[1]! & 0x0f) << 4) | ((a[2]! & 0x3c) >> 2);
    out[i + 2] = ((a[2]! & 0x03) << 6) | (a[3]! & 0x3f);
    i += 3;
    j += 4;
  }
  const bufa = [dec(input[j]!), dec(input[j + 1]!), dec(input[j + 2]!), dec(input[j + 3]!)];
  if (bufa[0] === 0xff || bufa[1] === 0xff || bufa[2] === 0xff || bufa[3] === 0xff) return null;
  let y = 0;
  if (input[len - 2] === 0x3d) y = 2;
  else if (input[len - 1] === 0x3d) y = 1;
  for (let z = 0; z < y; z++) bufa[4 - z - 1] = 0;
  const bufb = [
    (bufa[0]! << 2) | ((bufa[1]! & 0x30) >> 4),
    ((bufa[1]! & 0x0f) << 4) | ((bufa[2]! & 0x3c) >> 2),
    ((bufa[2]! & 0x03) << 6) | (bufa[3]! & 0x3f),
  ];
  let z = 0;
  for (; z < 3 - y; z++) out[i + z] = bufb[z]! & 0xff;
  i += z;
  return out.subarray(0, i);
}

function enc(inb: number): number {
  const n = inb & 0x3f;
  if (n === 7) return 0x44;
  if (n === 14) return 0x68;
  if (n === 59) return 0x2f;
  if (n >= 11 && n <= 36) return n + 65 - 11;
  if (n >= 47 && n <= 61) return n + 108 - 47;
  if (n <= 10) return n + 97;
  if (n >= 37 && n <= 46) return n + 48 - 37;
  if (n === 62) return 0x2b;
  if (n === 63) return 0x78;
  return 0xff;
}

function dec(inb: number): number {
  if (inb === 0x44) return 7;
  if (inb === 0x68) return 14;
  if (inb === 0x78) return 63;
  if (inb >= 65 && inb <= 90) return inb - 65 + 11;
  if (inb >= 97 && inb <= 107) return inb - 97;
  if (inb >= 108 && inb <= 122) return inb - 108 + 47;
  if (inb >= 48 && inb <= 57) return inb - 48 + 37;
  if (inb === 0x2b) return 62;
  if (inb === 0x2f) return 59;
  if (inb === 0x3d) return 64;
  return 0xff;
}

export { MR_FAILED };

/** RFC 1321 MD5. `mythroad.c` `_strCom(500)` uses stock md5. */
export function md5(bytes: Uint8Array): Uint8Array {
  const n = bytes.length;
  const bitLen = n * 8;
  const pad = (((n + 8) >> 6) + 1) << 6;
  const buf = new Uint8Array(pad);
  buf.set(bytes);
  buf[n] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(pad - 8, bitLen >>> 0, true);
  dv.setUint32(pad - 4, Math.floor(bitLen / 0x1_0000_0000), true);
  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;
  const w = new Int32Array(16);
  for (let i = 0; i < pad; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = dv.getInt32(i + j * 4, true);
    let A = a,
      B = b,
      C = c,
      D = d;
    const op = (f: number, k: number, s: number, t: number) => {
      const x = (A + f + w[k]! + t) | 0;
      A = D;
      D = C;
      C = B;
      B = (B + ((x << s) | (x >>> (32 - s)))) | 0;
    };
    const F = (x: number, y: number, z: number) => (x & y) | (~x & z);
    const G = (x: number, y: number, z: number) => (x & z) | (y & ~z);
    const H = (x: number, y: number, z: number) => x ^ y ^ z;
    const I = (x: number, y: number, z: number) => y ^ (x | ~z);
    const s1 = [7, 12, 17, 22];
    const s2 = [5, 9, 14, 20];
    const s3 = [4, 11, 16, 23];
    const s4 = [6, 10, 15, 21];
    const T = MD5_T;
    for (let i2 = 0; i2 < 16; i2++) op(F(B, C, D), i2, s1[i2 & 3]!, T[i2]!);
    for (let i2 = 0; i2 < 16; i2++) op(G(B, C, D), (1 + 5 * i2) & 15, s2[i2 & 3]!, T[16 + i2]!);
    for (let i2 = 0; i2 < 16; i2++) op(H(B, C, D), (5 + 3 * i2) & 15, s3[i2 & 3]!, T[32 + i2]!);
    for (let i2 = 0; i2 < 16; i2++) op(I(B, C, D), (7 * i2) & 15, s4[i2 & 3]!, T[48 + i2]!);
    a = (a + A) | 0;
    b = (b + B) | 0;
    c = (c + C) | 0;
    d = (d + D) | 0;
  }
  const out = new Uint8Array(16);
  const o = new DataView(out.buffer);
  o.setInt32(0, a, true);
  o.setInt32(4, b, true);
  o.setInt32(8, c, true);
  o.setInt32(12, d, true);
  return out;
}

const MD5_T = new Int32Array(64);
{
  for (let i = 0; i < 64; i++) MD5_T[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x1_0000_0000) | 0;
}
