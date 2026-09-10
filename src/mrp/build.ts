import { binToBytes } from "./archive.ts";
import { gzipStore } from "./gzip.ts";

export type BuildFile = {
  name: string;
  data: Uint8Array;
  gzip?: boolean;
};

export type BuildMrpOptions = {
  magic?: "MRPG" | "MRPF";
  filename?: string;
  appname?: string;
  appid?: number;
  version?: number;
  vendor?: string;
  description?: string;
  listStart?: number;
};

function wr32(u8: Uint8Array, off: number, v: number): void {
  u8[off] = v;
  u8[off + 1] = v >>> 8;
  u8[off + 2] = v >>> 16;
  u8[off + 3] = v >>> 24;
}

function wrStr(u8: Uint8Array, off: number, s: string, max: number): void {
  const b = binToBytes(s);
  const n = Math.min(b.length, max - 1);
  u8.set(b.subarray(0, n), off);
}

export function buildMrp(files: BuildFile[], opts: BuildMrpOptions = {}): Uint8Array {
  const listStart = opts.listStart ?? 240;
  const packed = files.map((f) => {
    const payload = f.gzip ? gzipStore(f.data) : f.data;
    const name = binToBytes(f.name);
    const nameField = new Uint8Array(name.length + 1);
    nameField.set(name);
    return { nameField, payload };
  });

  let indexSize = 0;
  for (const p of packed) indexSize += 4 + p.nameField.length + 12;
  const dataStart = listStart + indexSize;
  const payloads: { rec: Uint8Array; dataOff: number }[] = [];
  let cursor = dataStart;
  for (const p of packed) {
    const rec = new Uint8Array(4 + p.nameField.length + 4 + p.payload.length);
    wr32(rec, 0, p.nameField.length);
    rec.set(p.nameField, 4);
    wr32(rec, 4 + p.nameField.length, p.payload.length);
    rec.set(p.payload, 8 + p.nameField.length);
    const dataOff = cursor + 4 + p.nameField.length + 4;
    payloads.push({ rec, dataOff });
    cursor += rec.length;
  }

  const fileLen = cursor;
  const fileStart = dataStart - 8;
  const out = new Uint8Array(fileLen);
  out[0] = 0x4d;
  out[1] = 0x52;
  out[2] = 0x50;
  out[3] = (opts.magic ?? "MRPG") === "MRPF" ? 0x46 : 0x47;
  wr32(out, 4, fileStart);
  wr32(out, 8, fileLen);
  wr32(out, 12, listStart);
  wrStr(out, 16, opts.filename ?? "test.mrp", 12);
  wrStr(out, 28, opts.appname ?? "test", 24);
  wr32(out, 68, opts.appid ?? 1);
  wr32(out, 72, opts.version ?? 1);
  wrStr(out, 88, opts.vendor ?? "flymrp", 40);
  wrStr(out, 128, opts.description ?? "stage5a", 64);
  wr32(out, 192, ((opts.appid ?? 1) >>> 24) | (((opts.appid ?? 1) >>> 8) & 0xff00) | (((opts.appid ?? 1) << 8) & 0xff0000) | ((opts.appid ?? 1) << 24));
  wr32(out, 196, ((opts.version ?? 1) >>> 24) | (((opts.version ?? 1) >>> 8) & 0xff00) | (((opts.version ?? 1) << 8) & 0xff0000) | ((opts.version ?? 1) << 24));

  let ip = listStart;
  for (let i = 0; i < packed.length; i++) {
    const p = packed[i]!;
    const dataOff = payloads[i]!.dataOff;
    wr32(out, ip, p.nameField.length);
    ip += 4;
    out.set(p.nameField, ip);
    ip += p.nameField.length;
    wr32(out, ip, dataOff);
    wr32(out, ip + 4, p.payload.length);
    wr32(out, ip + 8, 0);
    ip += 12;
  }
  let dp = dataStart;
  for (const p of payloads) {
    out.set(p.rec, dp);
    dp += p.rec.length;
  }
  return out;
}
