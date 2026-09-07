import { audioDurationMs } from './audio-duration.ts';
import type { GuestMemory } from "../hot/memory.ts";

const TYPES = [-1, 0, 1, 2, 5, 3, 4, 6];
type Media = { device: number; data: Uint8Array | null; loop: number; status: number; position?: number; started?: number; duration?: number };
/** mrc_sound.h encodes commands as command * 10 + device. Buffers and
 * channel handles belong to one runtime; no guest pointer escapes to audio. */
export class MediaDevices {
  private devices = new Map<number, Media>();
  private channels = new Map<number, Media>();
  private nextHandle = 257;
  private statusAddress = 0;
  constructor(private hooks: {
    alloc: (size: number) => number;
    readFile: (name: string) => Uint8Array | null;
    play: (type: number, bytes: Uint8Array, loop: number, positionMs?: number) => void;
    getClock?: () => number;
    stop: (type: number) => void;
  }) {}

  dispatch(mem: GuestMemory, code: number, input: number, length: number, output: number, outputLength: number): number | null {
    const command = Math.floor(code / 10), device = code % 10;
    if (![201,202,203,204,205,206,207,208,209,212,213,215,216,222,223,224,225].includes(command)) return null;
    // Some players query device 0 before selecting a format. Report the
    // unsupported device (MR_IGNORE), rather than an unknown host ABI.
    if (!device || device > 7) return 1;
    const type = TYPES[device];
    const copy = (address: number, size: number) => {
      if (!address || !size || size > 16 * 1024 * 1024) return null;
      try { return mem.slice(address, size); } catch { return null; }
    };
    if (command === 222) {
      if (!input || length !== 12 || this.channels.size >= 32) return -1;
      const args = copy(input, 12); if (!args) return -1;
      const view = new DataView(args.buffer, args.byteOffset, 12);
      const data = copy(view.getUint32(0, true), view.getUint32(4, true));
      if (!data) return -1;
      const handle = this.nextHandle++;
      this.channels.set(handle, { device, data, loop: view.getInt32(8, true) ? 1 : 0, status: 3 });
      return handle;
    }
    if (command >= 223) {
      const arg = length === 4 ? copy(input, 4) : null; if (!arg) return -1;
      const handle = new DataView(arg.buffer, arg.byteOffset, 4).getUint32(0, true);
      const media = this.channels.get(handle); if (!media || media.device !== device) return -1;
      if (command === 223) { this.hooks.play(type, media.data!, media.loop); media.status = 4; }
      else { if (media.status === 4) this.hooks.stop(type); media.status = 3; }
      if (command === 225) this.channels.delete(handle);
      return 0;
    }
    let media = this.devices.get(device);
    if (!media) { media = { device, data: null, loop: 0, status: 1 }; this.devices.set(device, media); }
    const now = this.hooks.getClock?.() ?? 0;
    const position = () => {
      let pos = (media!.position ?? 0) + (media!.status === 4 ? Math.max(0, now - (media!.started ?? now)) : 0);
      if (media!.duration && pos >= media!.duration) {
        if (media!.loop) pos %= media!.duration;
        else { pos = media!.duration; media!.status = 3; media!.position = pos; }
      }
      return pos;
    };
    switch (command) {
      case 201: case 208: case 216:
        this.hooks.stop(type); media.data = null; media.position = 0; media.duration = 0; media.status = command === 201 ? 2 : 1; return 0;
      case 202: case 203: {
        const bytes = copy(input, length); if (!bytes) return -1;
        const data = command === 203 ? bytes : this.hooks.readFile(new TextDecoder("gbk").decode(bytes).split("\0")[0]);
        if (!data?.length) return -1;
        this.hooks.stop(type); media.data = data.slice(); media.position = 0; media.duration = audioDurationMs(data, type); media.status = 3; return 0;
      }
      case 204: case 206:
        if (!media.data) return -1;
        if (input && length >= 12) media.loop = mem.read32(input + 4) | 0;
        this.hooks.play(type, media.data, media.loop, media.position ?? 0); media.started = now; media.status = 4; return 0;
      case 205: case 207:
        media.position = command === 205 ? position() : 0; this.hooks.stop(type); media.status = command === 205 ? 5 : 3; return 0;
      case 212: case 213: case 215: {
        if (!output || !outputLength) return -1;
        const ms = command === 212 ? media.duration ?? 0 : position();
        this.statusAddress ||= this.hooks.alloc(4);
        mem.write32(this.statusAddress, Math.floor(command === 215 ? ms : ms / 1000));
        mem.write32(output, this.statusAddress); mem.write32(outputLength, 4);
        return 0;
      }
      case 209:
        position();
        if (output && outputLength) {
          this.statusAddress ||= this.hooks.alloc(4);
          mem.write32(this.statusAddress, 1000 + media.status);
          mem.write32(output, this.statusAddress); mem.write32(outputLength, 4);
        }
        return 1000 + media.status;
      default: return null;
    }
  }
}
