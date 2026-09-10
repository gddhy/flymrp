import { GuestMemory } from "../hot/memory.ts";

// rxgj md5.h: count[2], abcd[4], buf[64]. Keep the entire 88-byte context
// in guest memory so copying a context (or interleaving two) works naturally.
const SHIFT = [7,12,17,22, 5,9,14,20, 4,11,16,23, 6,10,15,21];
const K = Int32Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000));

export function guestMd5Init(mem: GuestMemory, p: number): number {
  if (!p) return 0;
  mem.write32(p, 0);
  mem.write32(p + 4, 0);
  [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476].forEach((n, i) => mem.write32(p + 8 + i * 4, n));
  return 0;
}

function compress(mem: GuestMemory, p: number): void {
  const h = Array.from({ length: 4 }, (_, i) => mem.read32(p + 8 + i * 4));
  let [a, b, c, d] = h;
  for (let i = 0; i < 64; i++) {
    const round = i >>> 4;
    const f = round === 0 ? (b & c) | (~b & d) : round === 1 ? (b & d) | (c & ~d) : round === 2 ? b ^ c ^ d : c ^ (b | ~d);
    const g = round === 0 ? i : round === 1 ? (5 * i + 1) & 15 : round === 2 ? (3 * i + 5) & 15 : (7 * i) & 15;
    const x = (a + f + K[i] + mem.read32(p + 24 + 4 * g)) | 0;
    const shift = SHIFT[round * 4 + (i & 3)];
    const next = (b + ((x << shift) | (x >>> (32 - shift)))) | 0;
    a = d; d = c; c = b; b = next;
  }
  [a, b, c, d].forEach((n, i) => mem.write32(p + 8 + i * 4, (h[i] + n) >>> 0));
}

function append(mem: GuestMemory, p: number, length: number, byte: (i: number) => number): void {
  const low = mem.read32(p) >>> 0;
  let offset = (low >>> 3) & 63;
  const next = (low + length * 8) >>> 0;
  mem.write32(p, next);
  mem.write32(p + 4, (mem.read32(p + 4) + (length >>> 29) + (next < low ? 1 : 0)) >>> 0);
  for (let i = 0; i < length; i++) {
    mem.write8(p + 24 + offset++, byte(i));
    if (offset === 64) { compress(mem, p); offset = 0; }
  }
}

export function guestMd5Append(mem: GuestMemory, p: number, data: number, length: number): number {
  if (p && data && (length | 0) > 0) append(mem, p, length | 0, i => mem.read8((data + i) >>> 0));
  return 0;
}

export function guestMd5Finish(mem: GuestMemory, p: number, digest: number): number {
  if (!p || !digest) return 0;
  const count = Array.from({ length: 8 }, (_, i) => mem.read8(p + i));
  const padding = ((55 - (mem.read32(p) >>> 3)) & 63) + 1;
  append(mem, p, padding, i => i === 0 ? 0x80 : 0);
  append(mem, p, 8, i => count[i]);
  const result = new Uint8Array(mem.slice(p + 8, 16));
  mem.load(digest, result);
  return 0;
}

/** Reuse the guest MD5 implementation for native download metadata. */
export function md5Bytes(bytes: Uint8Array): Uint8Array {
  const mem = new GuestMemory(0, 128);
  guestMd5Init(mem, 4);
  append(mem, 4, bytes.length, i => bytes[i]);
  guestMd5Finish(mem, 4, 96);
  return new Uint8Array(mem.slice(96, 16));
}
