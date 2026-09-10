export type MidiEvent = { time: number; message: number[] };
export type MidiSong = { events: MidiEvent[]; duration: number };

/** Bounded SMF 0/1 parser. Keep channel messages, SysEx, tempo changes and trailing rests. */
export function parseMidi(data: Uint8Array): MidiSong {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const four = (at: number) => String.fromCharCode(...data.subarray(at, at + 4));
  const invalid = (): never => { throw new Error("无效或不支持的 MIDI 文件"); };
  if (data.length < 14 || four(0) !== "MThd") invalid();
  const header = view.getUint32(4), format = view.getUint16(8), tracks = view.getUint16(10), division = view.getUint16(12);
  if (header < 6 || header + 8 > data.length || format > 1 || !tracks || !division) invalid();
  const raw: { tick: number; message?: number[]; tempo?: number }[] = [];
  let offset = header + 8, endTick = 0;
  for (let tr = 0; tr < tracks; tr++) {
    if (offset + 8 > data.length || four(offset) !== "MTrk") invalid();
    const end = offset + 8 + view.getUint32(offset + 4);
    if (end > data.length) invalid();
    let pos = offset + 8, tick = 0, running = 0;
    const byte = () => { if (pos >= end) invalid(); return data[pos++]; };
    const variable = () => {
      let value = 0;
      for (let n = 0; n < 4; n++) { const b = byte(); value = value * 128 + (b & 127); if (!(b & 128)) return value; }
      return invalid();
    };
    while (pos < end) {
      tick += variable();
      let status = byte();
      if (status < 128) { if (!running) invalid(); pos--; status = running; }
      if (status < 0xf0) {
        running = status;
        const length = (status & 0xe0) === 0xc0 ? 1 : 2;
        const message = [status];
        for (let n = 0; n < length; n++) { const b = byte(); if (b >= 128) invalid(); message.push(b); }
        raw.push({ tick, message });
      } else {
        running = 0;
        if (status === 0xff) {
          const type = byte(), length = variable();
          if (pos + length > end) invalid();
          if (type === 0x51) {
            if (length !== 3) invalid();
            const tempo = data[pos] * 65536 + data[pos + 1] * 256 + data[pos + 2];
            if (!tempo) invalid(); raw.push({ tick, tempo });
          }
          pos += length;
          if (type === 0x2f) { if (length) invalid(); break; }
        } else if (status === 0xf0 || status === 0xf7) {
          const length = variable(); if (pos + length > end) invalid();
          // F7 escape/continuation isn't a standalone SysEx message.
          if (status === 0xf0) raw.push({ tick, message: [status, ...data.subarray(pos, pos + length)] });
          pos += length;
        } else invalid();
      }
      if (raw.length > 200000 || tick > 0xffffffff) invalid();
    }
    endTick = Math.max(endTick, tick); offset = end;
  }
  raw.sort((a, b) => a.tick - b.tick);
  let secondsPerTick = .5 / division;
  const smpte = (division & 0x8000) !== 0;
  if (smpte) {
    const fps = 256 - (division >>> 8), subframes = division & 255;
    if (![24, 25, 29, 30].includes(fps) || !subframes) invalid();
    secondsPerTick = 1 / ((fps === 29 ? 30000 / 1001 : fps) * subframes);
  }
  const events: MidiEvent[] = [];
  let time = 0, previousTick = 0;
  for (const event of raw) {
    time += (event.tick - previousTick) * secondsPerTick; previousTick = event.tick;
    if (event.tempo && !smpte) secondsPerTick = event.tempo / 1000000 / division;
    if (event.message) events.push({ time, message: event.message });
  }
  return { events, duration: time + (endTick - previousTick) * secondsPerTick };
}
