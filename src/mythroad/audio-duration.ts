/** Synchronous metadata for handset duration queries before browser decoding. */
export function audioDurationMs(bytes: Uint8Array, type: number): number {
  if (type === 3) return bytes.length / 16; // 8 kHz, signed 16-bit mono PCM
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  if (type === 1 && bytes.length >= 12 && view.getUint32(0) === 0x52494646 && view.getUint32(8) === 0x57415645) {
    let rate = 0, size = 0;
    for (let p = 12; p + 8 <= bytes.length;) {
      const id = view.getUint32(p), n = view.getUint32(p + 4, true);
      if (n > bytes.length - p - 8) break;
      if (id === 0x666d7420 && n >= 16) rate = view.getUint32(p + 16, true);
      if (id === 0x64617461) size += n;
      p += 8 + n + (n & 1);
    }
    return rate ? size * 1000 / rate : 0;
  }
  if (type !== 2) return 0;
  let p = 0, milliseconds = 0;
  if (bytes.length >= 10 && bytes[0] === 73 && bytes[1] === 68 && bytes[2] === 51) {
    p = 10 + ((bytes[6] & 127) * 0x200000 + (bytes[7] & 127) * 0x4000 + (bytes[8] & 127) * 128 + (bytes[9] & 127));
    if (bytes[5] & 16) p += 10;
  }
  const mpeg1 = [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320];
  const mpeg2 = [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160];
  while (p + 4 <= bytes.length) {
    const h = view.getUint32(p), version = (h >>> 19) & 3, layer = (h >>> 17) & 3;
    const bitrate = (h >>> 12) & 15, sample = (h >>> 10) & 3;
    if ((h >>> 21) !== 0x7ff || version === 1 || layer !== 1 || !bitrate || bitrate === 15 || sample === 3) { p++; continue; }
    const rate = [44100,48000,32000][sample] / (version === 3 ? 1 : version === 2 ? 2 : 4);
    const samples = version === 3 ? 1152 : 576;
    const n = Math.floor((version === 3 ? 144 : 72) * (version === 3 ? mpeg1 : mpeg2)[bitrate] * 1000 / rate) + ((h >>> 9) & 1);
    if (n > bytes.length - p) break;
    milliseconds += samples * 1000 / rate; p += n;
  }
  return milliseconds;
}
