/**
 * rxgj FULL `mr_getCharBitmap` / sky16.
 *
 * Real `gb16.uc2`: UCS-2 codepoint index, 32 bytes/glyph, 16 rows × 2 bytes
 * MSB-first. Same layout as `xl_font_sky16_getChar`.
 *
 * Without a loaded UC2 file, glyphs are generated stand-ins (not readable CJK).
 * Without `gb12.uc2`, SMALL/MEDIUM/BIG all use gb16 metrics:
 *   ASCII (ch < 128): 8×16
 *   other:            16×16
 */

export const CHAR_H_16 = 16;
export const EN_CHAR_W_16 = 8;
export const CN_CHAR_W_16 = 16;
export const BYTES_PER_CHAR_16 = 32;
export const GB16_UC2_SIZE = 65536 * BYTES_PER_CHAR_16;

export type Glyph16 = {
  width: number;
  height: number;
  /** 16 rows × 2 bytes, MSB-first. Same layout as sky16 `font_sky16_bitbuf`. */
  bits: Uint8Array;
};

let uc2: Uint8Array | null = null;

export function loadGb16Uc2(bytes: Uint8Array): void {
  if (bytes.length < BYTES_PER_CHAR_16) {
    throw new RangeError(`gb16.uc2 too small: ${bytes.length}`);
  }
  uc2 = bytes;
}

export function unloadGb16Uc2(): void {
  uc2 = null;
}

export function gb16Uc2Loaded(): boolean {
  return uc2 !== null && uc2.length >= BYTES_PER_CHAR_16 * 128;
}

export function gb16Metrics(ch: number): { width: number; height: number } {
  const id = ch & 0xffff;
  if (id < 128) return { width: EN_CHAR_W_16, height: CHAR_H_16 };
  return { width: CN_CHAR_W_16, height: CHAR_H_16 };
}

export function gb16BitmapSize(width: number, height: number): number {
  return ((width * height) + 7) >> 3;
}

export function gb16Glyph(ch: number): Glyph16 {
  const id = ch & 0xffff;
  const { width, height } = gb16Metrics(id);
  const fromUc2 = uc2GlyphBits(id);
  if (fromUc2) return { width, height, bits: fromUc2 };
  const bits = new Uint8Array(BYTES_PER_CHAR_16);
  if (id < 128) writeAscii16(bits, id);
  else writeCjk16(bits, id);
  return { width, height, bits };
}

/**
 * Guest `is_unicode=0` text is GBK/GB2312. Official `_DrawText` runs `c2u`
 * then indexes `gb16.uc2` by UCS-2. Do not treat GBK pairs as codepoints.
 */
export function gbkBytesToUcs2(bytes: Uint8Array): number[] {
  const s = new TextDecoder("gbk").decode(bytes);
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    if (cp > 0xffff) {
      out.push(0xfffd);
      continue;
    }
    out.push(cp);
  }
  return out;
}

function uc2GlyphBits(id: number): Uint8Array | null {
  if (!uc2) return null;
  const off = id * BYTES_PER_CHAR_16;
  if (off + BYTES_PER_CHAR_16 > uc2.length) return null;
  return uc2.subarray(off, off + BYTES_PER_CHAR_16);
}

function writeRow16(bits: Uint8Array, y: number, row: number): void {
  bits[y * 2] = (row >>> 8) & 0xff;
  bits[y * 2 + 1] = row & 0xff;
}

/** 8×16: glyph occupies the high 8 bits of each 16-bit scanline. */
function writeAscii16(bits: Uint8Array, ch: number): void {
  if (ch <= 0x20) return;
  const rows = ascii8(ch);
  for (let y = 0; y < 16; y++) writeRow16(bits, y, (rows[y]! & 0xff) << 8);
}

function writeCjk16(bits: Uint8Array, ch: number): void {
  for (let y = 0; y < 16; y++) {
    let row = 0x8001;
    if (y === 0 || y === 15) row = 0xffff;
    else {
      const mix = ((ch * 0x9e37) ^ (y * 0x51)) & 0x3ffc;
      row |= mix;
    }
    writeRow16(bits, y, row);
  }
}

/** Very small generated 8×16 ASCII. Not a licensed bitmap font. */
function ascii8(ch: number): Uint8Array {
  const out = new Uint8Array(16);
  const c = ch & 0x7f;
  if (c < 0x21 || c > 0x7e) return out;
  const body = ((c - 0x20) * 0x1f) & 0xff;
  for (let y = 2; y < 14; y++) {
    let row = 0;
    if (y === 2 || y === 13) row = 0x7e;
    else if ((y & 1) === 0) row = 0x42 | (body & 0x18);
    else row = 0x42 | ((body << (y & 3)) & 0x3c);
    out[y] = row;
  }
  return out;
}
