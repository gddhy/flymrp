import {
  MR_SOUND_MIDI,
  MR_SOUND_MP3,
  MR_SOUND_PCM,
  MR_SOUND_WAV,
} from "../src/mythroad/index.ts";

type Voice = { stop: () => void };

/**
 * Browser sink for `mr_playSound`.
 * MIDI is a square-wave SMF player (not SoundFont).
 * WAV/MP3 use `decodeAudioData`. PCM is 8 kHz 16-bit LE mono.
 */
export class BrowserAudio {
  private ctx: AudioContext | null = null;
  private voices = new Map<number, Voice>();
  lastType: number | null = null;
  lastLen = 0;
  lastError: string | null = null;

  resume(): void {
    const ctx = this.ensure();
    if (ctx.state === "suspended") void ctx.resume();
  }

  play(type: number, data: Uint8Array | null, loop: number): void {
    this.lastType = type;
    this.lastLen = data?.length ?? 0;
    this.lastError = null;
    this.stop(type);
    if (!data || data.length === 0) return;
    try {
      const ctx = this.ensure();
      if (ctx.state === "suspended") void ctx.resume();
      if (type === MR_SOUND_MIDI) this.playMidi(ctx, type, data, loop !== 0);
      else if (type === MR_SOUND_PCM) this.playPcm(ctx, type, data, loop !== 0);
      else if (type === MR_SOUND_WAV || type === MR_SOUND_MP3) void this.playDecoded(ctx, type, data, loop !== 0);
      else this.lastError = `unsupported sound type ${type}`;
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
    }
  }

  stop(type: number): void {
    const v = this.voices.get(type);
    if (!v) return;
    this.voices.delete(type);
    try {
      v.stop();
    } catch {
      /* already stopped */
    }
  }

  stopAll(): void {
    for (const type of [...this.voices.keys()]) this.stop(type);
  }

  private ensure(): AudioContext {
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
    }
    return this.ctx;
  }

  private playPcm(ctx: AudioContext, type: number, data: Uint8Array, loop: boolean): void {
    const n = data.length >> 1;
    if (n <= 0) return;
    const buf = ctx.createBuffer(1, n, 8000);
    const ch = buf.getChannelData(0);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let i = 0; i < n; i++) ch[i] = view.getInt16(i << 1, true) / 32768;
    this.startBuffer(ctx, type, buf, loop);
  }

  private async playDecoded(ctx: AudioContext, type: number, data: Uint8Array, loop: boolean): Promise<void> {
    try {
      const copy = new ArrayBuffer(data.length);
      new Uint8Array(copy).set(data);
      const buf = await ctx.decodeAudioData(copy);
      if (this.lastType !== type) return;
      this.startBuffer(ctx, type, buf, loop);
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
    }
  }

  private startBuffer(ctx: AudioContext, type: number, buf: AudioBuffer, loop: boolean): void {
    this.stop(type);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    src.connect(ctx.destination);
    src.start();
    this.voices.set(type, {
      stop: () => {
        try {
          src.stop();
        } catch {
          /* already stopped */
        }
        src.disconnect();
      },
    });
  }

  private playMidi(ctx: AudioContext, type: number, data: Uint8Array, loop: boolean): void {
    const events = parseSmf(data);
    if (events.length === 0) {
      this.lastError = "empty MIDI";
      return;
    }
    const master = ctx.createGain();
    master.gain.value = 0.18;
    master.connect(ctx.destination);
    const oscs: OscillatorNode[] = [];
    const startAt = ctx.currentTime + 0.02;
    const lastT = events[events.length - 1]!.t;
    const schedule = (origin: number) => {
      for (const ev of events) {
        const when = origin + ev.t;
        if (ev.kind === "on") {
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = "square";
          osc.frequency.value = midiHz(ev.note);
          g.gain.setValueAtTime(0.0001, when);
          g.gain.exponentialRampToValueAtTime(Math.max(0.02, ev.vel / 127 * 0.35), when + 0.008);
          osc.connect(g);
          g.connect(master);
          osc.start(when);
          oscs.push(osc);
          ev.osc = osc;
          ev.gain = g;
        } else {
          const voice = ev.match;
          if (!voice?.osc || !voice.gain) continue;
          voice.gain.gain.cancelScheduledValues(when);
          voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), when);
          voice.gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.03);
          voice.osc.stop(when + 0.04);
        }
      }
    };
    schedule(startAt);
    let again: number | undefined;
    const voice: Voice = {
      stop: () => {
        if (again !== undefined) window.clearTimeout(again);
        for (const osc of oscs) {
          try {
            osc.stop();
          } catch {
            /* already stopped */
          }
          try {
            osc.disconnect();
          } catch {
            /* already disconnected */
          }
        }
        master.disconnect();
      },
    };
    this.voices.set(type, voice);
    if (loop && lastT > 0) {
      const period = Math.max(0.25, lastT + 0.1);
      again = window.setTimeout(() => {
        if (this.voices.get(type) !== voice) return;
        this.playMidi(ctx, type, data, true);
      }, period * 1000);
    }
  }
}

type MidiEv = {
  t: number;
  kind: "on" | "off";
  note: number;
  vel: number;
  ch: number;
  osc?: OscillatorNode;
  gain?: GainNode;
  match?: MidiEv;
};

function midiHz(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

function parseSmf(data: Uint8Array): MidiEv[] {
  if (data.length < 14) return [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (readFour(data, 0) !== "MThd") return [];
  const headerLen = view.getUint32(4, false);
  const ntrks = view.getUint16(10, false);
  const division = view.getUint16(12, false);
  const tpq = division & 0x8000 ? 96 : Math.max(1, division);
  let off = 8 + headerLen;
  const raw: { tick: number; kind: "on" | "off"; note: number; vel: number; ch: number }[] = [];
  let tempo = 500000;
  const tempos: { tick: number; us: number }[] = [{ tick: 0, us: tempo }];
  for (let tr = 0; tr < ntrks && off + 8 <= data.length; tr++) {
    if (readFour(data, off) !== "MTrk") break;
    const len = view.getUint32(off + 4, false);
    const end = Math.min(data.length, off + 8 + len);
    let i = off + 8;
    let tick = 0;
    let running = 0;
    while (i < end) {
      const dt = readVar(data, i, end);
      tick += dt.v;
      i = dt.next;
      if (i >= end) break;
      let status = data[i]!;
      if (status < 0x80) {
        status = running;
      } else {
        i++;
        running = status;
      }
      if (status === 0xff) {
        if (i + 1 >= end) break;
        const meta = data[i++]!;
        const ml = readVar(data, i, end);
        i = ml.next;
        if (meta === 0x51 && ml.v >= 3 && i + 2 < end) {
          tempo = ((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!) >>> 0;
          tempos.push({ tick, us: tempo || 500000 });
        }
        i += ml.v;
        continue;
      }
      if (status === 0xf0 || status === 0xf7) {
        const sl = readVar(data, i, end);
        i = sl.next + sl.v;
        continue;
      }
      const hi = status & 0xf0;
      const ch = status & 0x0f;
      if (hi === 0xc0 || hi === 0xd0) {
        i += 1;
        continue;
      }
      if (i + 1 >= end) break;
      const a = data[i++]!;
      const b = hi === 0xe0 || hi === 0xb0 || hi === 0xa0 || hi === 0x80 || hi === 0x90 ? data[i++]! : 0;
      if (hi === 0x90) {
        raw.push({ tick, kind: b ? "on" : "off", note: a, vel: b, ch });
      } else if (hi === 0x80) {
        raw.push({ tick, kind: "off", note: a, vel: b, ch });
      }
    }
    off = end;
  }
  raw.sort((a, b) => a.tick - b.tick || (a.kind === "off" ? -1 : 1));
  tempos.sort((a, b) => a.tick - b.tick);
  const out: MidiEv[] = [];
  const live = new Map<string, MidiEv>();
  for (const ev of raw) {
    const t = ticksToSec(ev.tick, tempos, tpq);
    if (ev.kind === "on") {
      const node: MidiEv = { t, kind: "on", note: ev.note, vel: ev.vel, ch: ev.ch };
      out.push(node);
      live.set(`${ev.ch}:${ev.note}`, node);
    } else {
      const node: MidiEv = { t, kind: "off", note: ev.note, vel: ev.vel, ch: ev.ch };
      node.match = live.get(`${ev.ch}:${ev.note}`);
      live.delete(`${ev.ch}:${ev.note}`);
      out.push(node);
    }
  }
  const endT = out.length ? out[out.length - 1]!.t + 0.05 : 0;
  for (const leftover of live.values()) {
    out.push({ t: endT, kind: "off", note: leftover.note, vel: 0, ch: leftover.ch, match: leftover });
  }
  out.sort((a, b) => a.t - b.t || (a.kind === "off" ? -1 : 1));
  return out;
}

function ticksToSec(tick: number, tempos: { tick: number; us: number }[], tpq: number): number {
  let sec = 0;
  let prev = 0;
  let us = tempos[0]?.us ?? 500000;
  for (const mark of tempos) {
    if (mark.tick >= tick) break;
    sec += ((mark.tick - prev) * us) / tpq / 1_000_000;
    prev = mark.tick;
    us = mark.us;
  }
  sec += ((tick - prev) * us) / tpq / 1_000_000;
  return sec;
}

function readFour(data: Uint8Array, off: number): string {
  return String.fromCharCode(data[off] ?? 0, data[off + 1] ?? 0, data[off + 2] ?? 0, data[off + 3] ?? 0);
}

function readVar(data: Uint8Array, off: number, end: number): { v: number; next: number } {
  let v = 0;
  let i = off;
  while (i < end) {
    const b = data[i++]!;
    v = ((v << 7) | (b & 0x7f)) >>> 0;
    if ((b & 0x80) === 0) break;
  }
  return { v, next: i };
}
