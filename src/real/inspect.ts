import { createHash } from "node:crypto";
import { isElf32, isMrpGcMap, parseExtImage } from "../abi/loader.ts";
import { LuaChunkFormatError, MrpFormatError } from "../err/errors.ts";
import { LuaChunkReader } from "../lua/chunk.ts";
import { MRPArchive } from "../mrp/archive.ts";
import { gunzip, isGzip } from "../mrp/gzip.ts";

export type FormatClass = "CONFIRMED" | "UNKNOWN" | "INVALID" | "UNSUPPORTED";

export type ResourceInfo = {
  name: string;
  offset: number;
  length: number;
  compressed: boolean;
  classification: FormatClass;
  format: string;
};

export type LuaChunkInfo = {
  name: string;
  version: number | null;
  source: string | null;
  nups: number;
  numparams: number;
  codeLen: number;
  classification: FormatClass;
};

export type ExtModuleInfo = {
  name: string;
  kind: "mrpgcmap" | "elf" | "raw";
  size: number;
  classification: FormatClass;
  notes: string[];
};

export type InspectResult = {
  classification: FormatClass;
  format: string;
  magic: string;
  size: number;
  sha256: string;
  entry: string | null;
  fileStart: number | null;
  fileLen: number | null;
  listStart: number | null;
  resources: ResourceInfo[];
  luaChunks: LuaChunkInfo[];
  extModules: ExtModuleInfo[];
  nested: { name: string; format: string }[];
  notes: string[];
  fixtureKind: "none" | "synthetic" | "real";
};

const LUA_MAGIC = [0x1b, 0x4d, 0x52, 0x50]; // \033MRP

export function sha256hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function magicAscii(data: Uint8Array, n = 8): string {
  const take = Math.min(n, data.length);
  let s = "";
  for (let i = 0; i < take; i++) {
    const c = data[i]!;
    s += c >= 32 && c < 127 ? String.fromCharCode(c) : ".";
  }
  return s;
}

export function inspectBytes(data: Uint8Array, opts: { name?: string; fixtureKind?: InspectResult["fixtureKind"] } = {}): InspectResult {
  const base: InspectResult = {
    classification: "UNKNOWN",
    format: "unknown",
    magic: magicAscii(data),
    size: data.length,
    sha256: sha256hex(data),
    entry: null,
    fileStart: null,
    fileLen: null,
    listStart: null,
    resources: [],
    luaChunks: [],
    extModules: [],
    nested: [],
    notes: [],
    fixtureKind: opts.fixtureKind ?? "none",
  };
  if (data.length === 0) {
    base.classification = "INVALID";
    base.format = "empty";
    base.notes.push("zero-length buffer");
    return base;
  }
  if (isMrpGcMap(data)) return inspectExt(data, opts.name ?? "<ext>", base);
  if (isElf32(data)) return inspectExt(data, opts.name ?? "<elf>", base);
  if (isMrpMagic(data)) return inspectMrp(data, base);
  if (isLuaMrp(data)) return inspectLua(data, opts.name ?? "<chunk>", base);
  if (isGzip(data)) return inspectGzip(data, base);
  if (looksLikeZip(data)) return inspectZip(data, base);
  base.notes.push("no confirmed magic; not classified as EXT/raw");
  return base;
}

function isMrpMagic(data: Uint8Array): boolean {
  if (data.length < 4) return false;
  const a = data[0]!;
  const b = data[1]!;
  const c = data[2]!;
  const d = data[3]!;
  return a === 0x4d && b === 0x52 && c === 0x50 && (d === 0x47 || d === 0x46);
}

function isLuaMrp(data: Uint8Array): boolean {
  if (data.length < 4) return false;
  return LUA_MAGIC.every((b, i) => data[i] === b);
}

function inspectMrp(data: Uint8Array, out: InspectResult): InspectResult {
  out.format = data[3] === 0x47 ? "MRPG" : "MRPF";
  try {
    const arc = MRPArchive.parse(data);
    out.classification = "CONFIRMED";
    out.fileStart = arc.header.fileStart;
    out.fileLen = arc.header.fileLen;
    out.listStart = arc.header.listStart;
    out.entry = arc.hasFile("start.mr") ? "start.mr" : null;
    if (!out.entry) out.notes.push("start.mr absent");
    for (const e of arc.entries) {
      let payload: Uint8Array;
      try {
        payload = arc.readFile(e.name);
      } catch {
        out.resources.push({
          name: e.name,
          offset: e.offset,
          length: e.storedLength,
          compressed: e.compressed,
          classification: "INVALID",
          format: "unreadable",
        });
        continue;
      }
      const inner = inspectBytes(payload, { name: e.name, fixtureKind: out.fixtureKind });
      out.resources.push({
        name: e.name,
        offset: e.offset,
        length: e.storedLength,
        compressed: e.compressed,
        classification: inner.classification,
        format: inner.format,
      });
      out.luaChunks.push(...inner.luaChunks);
      out.extModules.push(...inner.extModules);
      if (inner.format === "MRPG" || inner.format === "MRPF") out.nested.push({ name: e.name, format: inner.format });
      if (inner.format === "gzip") {
        for (const n of inner.nested) out.nested.push({ name: `${e.name}/${n.name}`, format: n.format });
        out.luaChunks.push(...inner.luaChunks);
      }
    }
    return out;
  } catch (e) {
    out.classification = "INVALID";
    out.notes.push(e instanceof MrpFormatError ? e.message : "MRP parse failed");
    return out;
  }
}

function inspectLua(data: Uint8Array, name: string, out: InspectResult): InspectResult {
  out.format = "lua-mrp";
  out.magic = "\\033MRP";
  try {
    const proto = LuaChunkReader.load(data);
    out.classification = "CONFIRMED";
    out.luaChunks.push({
      name,
      version: data.length > 4 ? data[4]! : null,
      source: proto.source,
      nups: proto.nups,
      numparams: proto.numparams,
      codeLen: proto.code.length,
      classification: "CONFIRMED",
    });
    return out;
  } catch (e) {
    out.classification = "INVALID";
    out.luaChunks.push({
      name,
      version: data.length > 4 ? data[4]! : null,
      source: null,
      nups: 0,
      numparams: 0,
      codeLen: 0,
      classification: "INVALID",
    });
    out.notes.push(e instanceof LuaChunkFormatError ? e.message : "Lua chunk parse failed");
    return out;
  }
}

function inspectGzip(data: Uint8Array, out: InspectResult): InspectResult {
  out.format = "gzip";
  out.classification = "CONFIRMED";
  try {
    const inner = gunzip(data);
    const child = inspectBytes(inner, { fixtureKind: out.fixtureKind });
    out.notes.push(`gzip payload ${inner.length} bytes → ${child.format}/${child.classification}`);
    out.luaChunks.push(...child.luaChunks);
    out.extModules.push(...child.extModules);
    if (child.format !== "unknown") out.nested.push({ name: "<gzip>", format: child.format });
    return out;
  } catch {
    out.classification = "INVALID";
    out.notes.push("gzip magic present but inflate failed");
    return out;
  }
}

function inspectExt(data: Uint8Array, name: string, out: InspectResult): InspectResult {
  try {
    const img = parseExtImage(data);
    const confirmed = img.kind === "mrpgcmap" || img.kind === "elf";
    out.format = `ext-${img.kind}`;
    out.classification = confirmed ? "CONFIRMED" : "UNKNOWN";
    out.extModules.push({
      name,
      kind: img.kind,
      size: data.length,
      classification: out.classification,
      notes: confirmed ? [`load+${img.loadOffset} P+${img.pOffset} table+${img.tableOffset}`] : ["raw EXT is not assumed"],
    });
    if (!confirmed) out.notes.push("raw image without MRPGCMAP/ELF is not guessed as EXT");
    return out;
  } catch (e) {
    out.classification = "INVALID";
    out.format = "ext";
    out.notes.push(e instanceof Error ? e.message : "EXT inspect failed");
    return out;
  }
}

function looksLikeZip(data: Uint8Array): boolean {
  return (
    data.length >= 4 &&
    data[0] === 0x50 &&
    data[1] === 0x4b &&
    ((data[2] === 0x03 && data[3] === 0x04) ||
      (data[2] === 0x05 && data[3] === 0x06) ||
      (data[2] === 0x07 && data[3] === 0x08))
  );
}

function inspectZip(data: Uint8Array, out: InspectResult): InspectResult {
  out.format = "ZIP/JAR";
  out.classification = "CONFIRMED";
  const listed = listZipNames(data);
  if (!listed) {
    out.classification = "INVALID";
    out.notes.push("ZIP magic but EOCD not found");
    return out;
  }
  if (listed.encrypted) {
    out.classification = "UNSUPPORTED";
    out.notes.push("ZIP encryption flag set; not decrypted");
  }
  for (const n of listed.names) {
    out.resources.push({
      name: n,
      offset: 0,
      length: 0,
      compressed: true,
      classification: /\.(mrp|mr)$/i.test(n) ? "UNKNOWN" : "CONFIRMED",
      format: /\.(mrp|mr)$/i.test(n) ? "zip-member-mrp?" : "zip-member",
    });
    if (/\.(mrp|mr)$/i.test(n)) out.notes.push(`ZIP contains ${n}; not extracted (container only)`);
  }
  out.notes.push("ZIP/JAR is a container identity, not an MRP");
  return out;
}

function listZipNames(data: Uint8Array): { names: string[]; encrypted: boolean } | null {
  let eocd = -1;
  const start = Math.max(0, data.length - 22 - 65535);
  for (let i = data.length - 22; i >= start; i--) {
    if (data[i] === 0x50 && data[i + 1] === 0x4b && data[i + 2] === 0x05 && data[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const cdOff = u32(data, eocd + 16);
  const cdSize = u32(data, eocd + 12);
  const names: string[] = [];
  let encrypted = false;
  let p = cdOff;
  const end = Math.min(data.length, cdOff + cdSize);
  while (p + 46 <= end) {
    if (data[p] !== 0x50 || data[p + 1] !== 0x4b || data[p + 2] !== 0x01 || data[p + 3] !== 0x02) break;
    const flag = data[p + 8]! | (data[p + 9]! << 8);
    if (flag & 1) encrypted = true;
    const nameLen = data[p + 28]! | (data[p + 29]! << 8);
    const extra = data[p + 30]! | (data[p + 31]! << 8);
    const comment = data[p + 32]! | (data[p + 33]! << 8);
    let name = "";
    for (let i = 0; i < nameLen && p + 46 + i < data.length; i++) name += String.fromCharCode(data[p + 46 + i]!);
    if (name) names.push(name);
    p += 46 + nameLen + extra + comment;
  }
  return { names, encrypted };
}

function u32(data: Uint8Array, off: number): number {
  return (data[off]! | (data[off + 1]! << 8) | (data[off + 2]! << 16) | (data[off + 3]! << 24)) >>> 0;
}
