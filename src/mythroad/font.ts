/**
 * rxgj FULL `mr_getCharBitmap` / sky16 metrics.
 *
 * Without `gb12.uc2`, `xl_font_should_use_12` is false for every fontSize,
 * so SMALL/MEDIUM/BIG all use gb16 metrics:
 *   ASCII (ch < 128): 8×16
 *   other:            16×16
 *
 * Glyph bits are generated. They are not pixel-identical to `gb16.uc2`.
 * Metrics are CONFIRMED from `dsm.c`. Bitmap pixels are a documented
 * compatibility stand-in until a real UC2 bundle is loaded.
 */

export const CHAR_H_16 = 16;
export const EN_CHAR_W_16 = 8;
export const CN_CHAR_W_16 = 16;
export const BYTES_PER_CHAR_16 = 32;

export type Glyph16 = {
  width: number;
  height: number;
  /** 16 rows × 2 bytes, MSB-first. Same layout as sky16 `font_sky16_bitbuf`. */
  bits: Uint8Array;
};

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
  const bits = new Uint8Array(BYTES_PER_CHAR_16);
  if (id < 128) writeAscii16(bits, id);
  else writeCjk16(bits, id);
  return { width, height, bits };
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
