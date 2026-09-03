import { GuestMemory } from "../hot/memory.ts";
import { EXT_CODE_ADDR, EXT_TABLE_ADDR, MRPGCMAP } from "./layout.ts";

export type ExtImageKind = "mrpgcmap" | "elf" | "raw";

export type ExtImage = {
  kind: ExtImageKind;
  bytes: Uint8Array;
  /** Offset of mr_c_function_load in the mapped image. */
  loadOffset: number;
  pOffset: number;
  tableOffset: number;
  /** ELF PT_LOAD segments, guest vaddr as stored in the file. */
  segments?: ElfSegment[];
  entry?: number;
};

export type ElfSegment = {
  vaddr: number;
  memsz: number;
  filesz: number;
  offset: number;
};

export type MappedExt = {
  image: ExtImage;
  dest: number;
  length: number;
  loadAddr: number;
};

const ELFMAG = new Uint8Array([0x7f, 0x45, 0x4c, 0x46]);

export function isMrpGcMap(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  for (let i = 0; i < 8; i++) if (bytes[i] !== MRPGCMAP[i]) return false;
  return true;
}

export function isElf32(bytes: Uint8Array): boolean {
  if (bytes.length < 52) return false;
  for (let i = 0; i < 4; i++) if (bytes[i] !== ELFMAG[i]) return false;
  return bytes[4] === 1 && bytes[5] === 1;
}

function u16(bytes: Uint8Array, off: number): number {
  return bytes[off]! | (bytes[off + 1]! << 8);
}

function u32(bytes: Uint8Array, off: number): number {
  return (
    bytes[off]! |
    (bytes[off + 1]! << 8) |
    (bytes[off + 2]! << 16) |
    (bytes[off + 3]! << 24)
  ) >>> 0;
}

export function parseElf32(bytes: Uint8Array): ExtImage {
  const phoff = u32(bytes, 28);
  const phentsize = u16(bytes, 42);
  const phnum = u16(bytes, 44);
  const entry = u32(bytes, 24);
  const segments: ElfSegment[] = [];
  for (let i = 0; i < phnum; i++) {
    const o = phoff + i * phentsize;
    if (o + 32 > bytes.length) break;
    const type = u32(bytes, o);
    if (type !== 1) continue;
    segments.push({
      offset: u32(bytes, o + 4),
      vaddr: u32(bytes, o + 8),
      filesz: u32(bytes, o + 16),
      memsz: u32(bytes, o + 20),
    });
  }
  return {
    kind: "elf",
    bytes,
    loadOffset: 8,
    pOffset: 4,
    tableOffset: 0,
    segments,
    entry,
  };
}

/**
 * Inspect the payload. Do not assume every EXT is MRPGCMAP-at-0.
 * +0 table pointer / +4 P / +8 mr_c_function_load apply after mapping,
 * once the host overwrites +0 with the table address.
 */
export function parseExtImage(bytes: Uint8Array): ExtImage {
  if (bytes.length < 12) {
    throw new RangeError("EXT image shorter than 12 bytes");
  }
  if (isMrpGcMap(bytes)) {
    return { kind: "mrpgcmap", bytes, loadOffset: 8, pOffset: 4, tableOffset: 0 };
  }
  if (isElf32(bytes)) return parseElf32(bytes);
  return { kind: "raw", bytes, loadOffset: 8, pOffset: 4, tableOffset: 0 };
}

function copyBytes(mem: GuestMemory, dest: number, src: Uint8Array, srcOff: number, len: number): void {
  const slice = src.subarray(srcOff, srcOff + len);
  mem.load(dest, slice);
}

/**
 * Map an EXT image into guest memory at `dest`.
 * Always writes table pointer at dest+0. Never treats host pointers as guest addresses.
 */
export function mapExtImage(
  mem: GuestMemory,
  image: ExtImage,
  dest = EXT_CODE_ADDR,
): MappedExt {
  dest >>>= 0;
  if (image.kind === "elf" && image.segments && image.segments.length) {
    const vaddrs = image.segments.map((s) => s.vaddr);
    const minVa = Math.min(...vaddrs);
    const relocate = minVa < 0x1000;
    let end = dest;
    for (const seg of image.segments) {
      const gva = relocate ? (dest + (seg.vaddr - minVa)) >>> 0 : seg.vaddr >>> 0;
      if (seg.memsz) mem.fill(gva, 0, seg.memsz);
      if (seg.filesz) {
        copyBytes(mem, gva, image.bytes, seg.offset, Math.min(seg.filesz, image.bytes.length - seg.offset));
      }
      end = Math.max(end, gva + seg.memsz);
    }
    mem.write32(dest + image.tableOffset, EXT_TABLE_ADDR);
    return {
      image,
      dest,
      length: (end - dest) >>> 0,
      loadAddr: (dest + image.loadOffset) >>> 0,
    };
  }

  mem.load(dest, image.bytes);
  mem.write32(dest + image.tableOffset, EXT_TABLE_ADDR);
  return {
    image,
    dest,
    length: image.bytes.length,
    loadAddr: (dest + image.loadOffset) >>> 0,
  };
}

export function readExtHeader(mem: GuestMemory, dest: number): { table: number; p: number; load: number } {
  return {
    table: mem.read32(dest),
    p: mem.read32(dest + 4),
    load: dest + 8,
  };
}
