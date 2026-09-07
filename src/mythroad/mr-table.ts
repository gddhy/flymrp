import { EXT_STACK_ADDR, EXT_TABLE_COUNT, MR_MAX_FILENAME_SIZE, tableSlotIndex, tableSlotAddr } from "../abi/layout.ts";
import type { ExtRuntime } from "../abi/runtime.ts";
import { UnknownAbiError, MrpFormatError } from "../err/errors.ts";
import type { GuestMemory } from "../hot/memory.ts";
import { guestMd5Init, guestMd5Append, guestMd5Finish } from "./guest-md5.ts";
import { MRPArchive } from "../mrp/index.ts";
import { AppFileSystem } from "./app-fs.ts";
import { MR_CHECK_TOUCH, MR_CHINESE, MR_FAILED, MR_GET_HANDSET_LG, MR_IGNORE, MR_IS_FILE, MR_IS_INVALID, MR_NET_ID_MOBILE, MR_STATE_RUN, MR_SUCCESS, MR_SWITCHPATH, MR_TOUCH_SCREEN } from "./constants.ts";
import { MythroadTimer } from "./timer.ts";
import { ScreenBuffer, asI16 } from "./graphics.ts";
import { BYTES_PER_CHAR_16, gb16BitmapSize, gb16Glyph, gbkBytesToUcs2, ucs2ToGbk } from "./font.ts";
import { CurrentPackFileBackend, type PackFileSource } from "./pack-file.ts";
import { defaultProfile, lcgNext, type DeviceProfile } from "./profile.ts";
import { aapcsPrintfVararg, aapcsSprintfVararg, guestPrintf, guestSprintf } from "./sprintf.ts";
import type { MythroadVfs } from "./vfs.ts";
import { GuestHeap } from "./guest-heap.ts";
import { MediaDevices } from "./media.ts";
import { OfflineNetwork } from "./offline-network.ts";

/** `sizeof(mr_userinfo)` in `mrporting.h`. */
export const MR_USERINFO_SIZE = 64;

/** C strtoul on the guest's 32-bit unsigned long, including base autodetection. */
export function guestStrtoul(value: string, radix: number): number {
  let text = value.trimStart(), negative = false;
  if (text[0] === "-" || text[0] === "+") { negative = text[0] === "-"; text = text.slice(1); }
  if (radix !== 0 && (radix < 2 || radix > 36)) return 0;
  if ((radix === 0 || radix === 16) && /^0x[0-9a-f]/i.test(text)) { radix = 16; text = text.slice(2); }
  if (!radix) radix = text[0] === "0" ? 8 : 10;
  let n = 0n;
  for (const ch of text.toLowerCase()) {
    const c = ch.charCodeAt(0), digit = c >= 48 && c <= 57 ? c - 48 : c >= 97 && c <= 122 ? c - 87 : 99;
    if (digit >= radix) break;
    n = n * BigInt(radix) + BigInt(digit);
    if (n > 0xffffffffn) return 0xffffffff;
  }
  return Number(negative ? BigInt.asUintN(32, -n) : n);
}
export const MR_USERINFO_IMEI_OFF = 0;
export const MR_USERINFO_IMSI_OFF = 16;
export const MR_USERINFO_MANU_OFF = 32;
export const MR_USERINFO_TYPE_OFF = 40;
export const MR_USERINFO_VER_OFF = 48;
export const MR_USERINFO_SPARE_OFF = 52;

/**
 * rxgj `dsm.c`: `info->ver = 101000000 + plat * 10000 + FAE`.
 * flymrp default is plat=2 / FAE=180 when `DeviceProfile.hsver` is not already packed.
 * This is flymrp profile / rxgj FULL compatibility, not a claimed MTK chip or real IMEI.
 */
export const MR_USERINFO_VER_BASE = 101000000;
export const MR_USERINFO_PLAT_DEFAULT = 2;
export const MR_USERINFO_FAE_DEFAULT = 180;

export function packedUserInfoVer(hsver: number): number {
  const v = hsver | 0;
  if (v >= MR_USERINFO_VER_BASE) return v >>> 0;
  return (MR_USERINFO_VER_BASE + MR_USERINFO_PLAT_DEFAULT * 10000 + MR_USERINFO_FAE_DEFAULT) >>> 0;
}

/** Write a NUL-terminated field; last byte stays 0. */
export function writeFixedCString(mem: GuestMemory, addr: number, s: string, fieldLen: number): void {
  const a = addr >>> 0;
  const n = fieldLen >>> 0;
  if (n === 0) return;
  mem.fill(a, 0, n);
  const take = Math.min(s.length, n - 1);
  for (let i = 0; i < take; i++) mem.write8((a + i) >>> 0, s.charCodeAt(i) & 0xff);
}

/**
 * rxgj FULL `_mr_TestCom` under `#ifdef MR_PLAT_DRAWTEXT`.
 * Not universal Mythroad. Not a flymrp capability probe.
 */
export const MR_TESTCOM_CASE7 = 7;

/**
 * Observed LIVE `mr_platEx` code. `0x4c6 == 1222 == MR_TURONBACKLIGHT` numerically.
 * This stage only returns `MR_SUCCESS`; it is not a backlight implementation.
 */
export const MR_PLATEX_CODE_4C6 = 0x4c6;

/**
 * rxgj `dsm.c` work-path roots. Guest-visible DSM strings, not host paths.
 * This is rxgj FULL compatibility, not a claimed device drive letter.
 */
export const MYTHROAD_WORK_PATH = "mythroad/";
export const DSM_HIDE_DRIVE = "mythroad/disk/";
export const DSM_DRIVE_A = "mythroad/disk/a/";
export const DSM_DRIVE_B = "mythroad/disk/b/";
export const DSM_DRIVE_X = "mythroad/disk/x/";
export const DSM_SWITCHPATH_BUF = 266;

/** rxgj `dsmSwitchPath('Y')` when `dsmWorkPath == "mythroad/"`. */
export const DSM_SWITCHPATH_Y_DEFAULT = "c:/mythroad/";

/** Cap guest `mr_playSound` copies. Larger streams stay recorded-only. */
export const PLAYSOUND_COPY_MAX = 8 * 1024 * 1024;

/** Observed LIVE `mr_plat` codes. */
export const MR_PLAT_GET_HANDSET_LG = MR_GET_HANDSET_LG;
export const MR_PLAT_CHECK_TOUCH = MR_CHECK_TOUCH;

export type AllocRecord = {
  size: number;
  alignedSize: number;
  guestAddr: number;
  owner: string;
  /** Still owned by the allocation registry. Freed records stay in `allocs` but `live` is false. */
  live: boolean;
};

export type ReadFileRecord = {
  name: string;
  lookfor: number;
  guestAddr: number;
  length: number;
};

/**
 * Mythroad `mr_table[0]` / `[14]` / `[125]` / `[130]` (case 7) / `[38]` (code 0x4c6 only) /
 * `[33]` (`mr_getTime`) / `[17]` (`sprintf_` guest integer/string formats) /
 * `[40]`/`[44]`/`[45]`/`[41]` current-pack read-only file alias /
 * `[3]` `memcpy2` / `[10]` `strcmp2` / `[9]` `memcmp2` /
 * `[1]` `mr_free` (shared guest first-fit heap) /
 * `[30]` `mr_getCharBitmap` (rxgj FULL gb16 metrics; generated glyphs).
 * table[100] is a 128-byte `pack_filename` data slot, not a function ABI.
 * Uses a guest-visible first-fit pool with the EXT bump heap as fallback.
 */
export class MrTableBridge {
  private heap: GuestHeap | null = null;
  private screenAddr = 0;
  readonly allocs: AllocRecord[] = [];
  readonly reads: ReadFileRecord[] = [];
  readonly files: CurrentPackFileBackend;
  readonly appFs = new AppFileSystem();
  unknownRequiredSlot: number | null = null;
  /** rxgj `char_bitmap_addr`: one 32-byte EXT bump slot, reused. */
  charBitmapAddr = 0;
  private lastExtRead: Uint8Array | null = null;
  /** Guest buffer for `mr_platEx(1204)` `'Y'` path query. Reused. */
  switchPathAddr = 0;
  private diskInfoAddr = 0;
  private randSeed: number | null = null;
  networkMode: string | null = null;
  readonly offlineNetwork = new OfflineNetwork();
  readonly missingComponents = new Set<string>();
  private readonly media = new MediaDevices({
    alloc: size => this.ext.alloc(size),
    readFile: name => this.appFs.file(name),
    play: (type, bytes, loop) => this.hooks.onPlaySound?.(type, bytes, loop),
    stop: type => this.stopSound(type),
  });
  volume = 100;
  /** rxgj `dsmWorkPath`. Starts at `mythroad/`. */
  workPath = MYTHROAD_WORK_PATH;
  /** Isolated-test screen when `hooks.getScreen` is absent. */
  screen = new ScreenBuffer(240, 320);
  /**
   * Isolated-test clock when `hooks.getClock` is absent.
   * Production always reads `MythroadRuntime.clock` via `getClock`.
   */
  clock = 0;
  private lastTimeCall = { serial: -1, bridge: -1, instructions: 0 };
  private pollingInstructions = 0;
  /** Isolated-test timer when `hooks.getTimer` is absent. */
  localTimer = new MythroadTimer();

  constructor(
    readonly ext: ExtRuntime,
    readonly vfs: MythroadVfs,
    readonly owner: string,
    readonly hooks: {
      onUnknownSlot?: (n: number) => void;
      onAlloc?: (rec: AllocRecord) => void;
      onRead?: (rec: ReadFileRecord) => void;
      getClock?: () => number;
      onSleep?: (ms: number) => void;
      onExit?: () => void;
      getPack?: () => PackFileSource | null;
      getProfile?: () => DeviceProfile;
      getScreen?: () => ScreenBuffer;
      onDrawRect?: (x: number, y: number, w: number, h: number, r: number, g: number, b: number) => void;
      onDrawText?: (text: string, x: number, y: number, r: number, g: number, b: number, unicode: number, font: number) => void;
      onFlush?: (x: number, y: number, w: number, h: number) => void;
      onPlaySound?: (type: number, data: Uint8Array | null, loop: number) => void;
      onStopSound?: (type: number) => void;
      onUnknownAbi?: (info: { family: string; code: string | number; message: string }) => void;
      getTimer?: () => MythroadTimer;
      getMrState?: () => number;
    } = {},
  ) {
    this.files = new CurrentPackFileBackend(() => this.hooks.getPack?.() ?? null, this.appFs);
  }

  install(): void {
    // mythroad.c publishes addresses of these globals, not function pointers.
    // Games read them directly to size their clear/background operations.
    const screen = this.hooks.getScreen?.() ?? this.screen;
    if (!this.screenAddr) {
      // Native drawing and guest direct pixel writes share one RGB565 buffer.
      // A second frame is reserved for legacy SDK framebuffer scratch space.
      this.screenAddr = this.ext.alloc(screen.pixels.byteLength * 2);
      const shared = new Uint16Array(this.ext.mem.ram8.buffer,
        this.screenAddr - this.ext.mem.ramBase, screen.pixels.length);
      shared.set(screen.pixels);
      screen.pixels = shared;
      this.ext.mem.write32(this.ext.mem.read32(tableSlotAddr(91)), this.screenAddr);
      const bitmap = this.ext.mem.read32(tableSlotAddr(95)) + 30 * 16;
      this.ext.mem.write16(bitmap, screen.width); this.ext.mem.write16(bitmap + 2, screen.height);
      this.ext.mem.write32(bitmap + 4, screen.pixels.byteLength);
      this.ext.mem.write32(bitmap + 12, this.screenAddr);
    }
    this.heap ??= new GuestHeap(this.ext);
    for (const [slot, value] of [[92, screen.width], [93, screen.height], [94, 16]]) {
      this.ext.mem.write32(this.ext.mem.read32(tableSlotAddr(slot)), value);
    }
    this.ext.registerHandler(0, (_cpu, _mem, args) => this.malloc(args[0]! >>> 0));
    this.ext.registerHandler(1, (_cpu, _mem, args) => this.free(args[0]! >>> 0, args[1]! >>> 0));
    this.ext.registerHandler(2, (_cpu, mem, args) => {
      const [p, oldLen, newLen] = args;
      if (!p) return this.malloc(newLen);
      if (!newLen) { this.free(p, oldLen); return 0; }
      const next = this.malloc(newLen);
      if (next) {
        memmove2(mem, next, p, Math.min(oldLen, newLen));
        this.free(p, oldLen);
      }
      return next;
    });
    this.ext.registerHandler(3, (_cpu, mem, args) => memcpy2(mem, args[0]!, args[1]!, args[2]!));
    this.ext.registerHandler(4, (_cpu, mem, args) => memmove2(mem, args[0]!, args[1]!, args[2]!));
    this.ext.registerHandler(5, (_cpu, mem, args) => strcpy2(mem, args[0]!, args[1]!));
    this.ext.registerHandler(6, (_cpu, mem, args) => strncpy2(mem, args[0]!, args[1]!, args[2]!));
    this.ext.registerHandler(7, (_cpu, mem, args) => strcat2(mem, args[0]!, args[1]!));
    this.ext.registerHandler(8, (_cpu, mem, [dst, src, count]) => {
      let end = dst;
      while (mem.read8(end)) end++;
      for (let i = 0; i < count; i++) { const c = mem.read8(src + i); if (!c) break; mem.write8(end++, c); }
      mem.write8(end, 0);
      return dst;
    });
    this.ext.registerHandler(11, (_cpu, mem, [a, b, count]) => {
      for (let i = 0; i < count; i++) { const x = mem.read8(a + i), y = mem.read8(b + i); if (x !== y) return x - y; if (!x) break; }
      return 0;
    });
    this.ext.registerHandler(15, (_cpu, mem, args) => strlen2(mem, args[0]!));
    this.ext.registerHandler(16, (_cpu, mem, args) => {
      const haystack = args[0] >>> 0, needle = args[1] >>> 0;
      if (!mem.read8(needle)) return haystack;
      for (let p = haystack; mem.read8(p); p++) {
        let i = 0;
        while (mem.read8(needle + i) && mem.read8(p + i) === mem.read8(needle + i)) i++;
        if (!mem.read8(needle + i)) return p;
      }
      return 0;
    });
    this.ext.registerHandler(18, (_cpu, mem, args) => atoi2(mem, args[0]!));
    this.ext.registerHandler(19, (_cpu, mem, [ptr, radix]) => guestStrtoul(readGuestCString(mem, ptr), radix));
    this.ext.registerHandler(20, () => {
      this.randSeed = lcgNext(this.randSeed ?? (this.hooks.getProfile?.() ?? defaultProfile()).randSeed);
      return (this.randSeed >>> 16) & 0x7fff;
    });
    this.ext.registerHandler(9, (_cpu, mem, args) => memcmp2(mem, args[0]!, args[1]!, args[2]!));
    this.ext.registerHandler(10, (_cpu, mem, args) => strcmp2(mem, args[0]!, args[1]!));
    this.ext.registerHandler(14, (_cpu, mem, args) => this.memset(mem, args[0]!, args[1]!, args[2]!));
    this.ext.registerHandler(125, (_cpu, mem, args) => this.readFile(mem, args[0]! >>> 0, args[1]! >>> 0, args[2]! | 0));
    this.ext.registerHandler(132, (_cpu, mem, [input, error, size]) => {
      const chars = gbkBytesToUcs2(Uint8Array.from(readGuestCString(mem, input), ch => ch.charCodeAt(0)));
      const length = (chars.length + 1) * 2, output = this.malloc(length);
      if (error) mem.write32(error, 0xffffffff);
      if (size) mem.write32(size, output ? length : 0);
      if (!output) return 0;
      [...chars, 0].forEach((ch, i) => { mem.write8(output + i * 2, ch >>> 8); mem.write8(output + i * 2 + 1, ch & 255); });
      return output;
    });
    this.ext.registerHandler(130, (_cpu, _mem, args) => this.testCom(args));
    this.ext.registerHandler(131, (_cpu, _mem, args) => {
      if (args[1] === 9) {
        const address = args[2] >>> 0;
        const length = args[3] >>> 0;
        const image = this.lastExtRead;
        // rxgj aex_t131 private-loader staging: preserve its record/P header,
        // restore the immutable EXT tail when its staging body is still blank.
        const privateChunk = this.ext.privateLoaderChunk(address, length);
        if (image && image.length === length && length > 16 && address &&
            this.ext.mem.read32(address) && this.ext.mem.read32(address + 4) &&
            (privateChunk || (this.ext.mem.read32(address + 8) === 0 && this.ext.mem.read32(address + 12) === 0))) {
          this.ext.mem.load(address + 8, image.subarray(8));
          if (privateChunk) {
            const record = this.ext.mem.read32(address);
            this.ext.mem.write32(record + 125 * 4, tableSlotAddr(125));
          }
          this.ext.owners.stage(address, length);
          this.ext.addCodeRegion(address, length);
        }
        this.ext.cache.invalidate(address, length);
        return MR_SUCCESS;
      }
      throw new UnknownAbiError(`unsupported TestCom1 case ${args[1]}`, { family: "_mr_TestCom1", code: args[1], caller: "ext" });
    });
    this.ext.registerHandler(38, (_cpu, mem, args) => this.platEx(mem, args));
    this.ext.registerHandler(34, (_cpu, mem, args) => {
      const p = args[0] >>> 0;
      if (!p) return MR_FAILED;
      const d = (this.hooks.getProfile?.() ?? defaultProfile()).datetime;
      mem.write16(p, d.year);
      [d.month, d.day, d.hour, d.minute, d.second].forEach((n, i) => mem.write8(p + 2 + i, n));
      return MR_SUCCESS;
    });
    this.ext.registerHandler(36, (_cpu, _mem, args) => {
      const ms = args[0] >>> 0;
      if (this.hooks.onSleep) this.hooks.onSleep(ms);
      else this.clock += ms;
      return MR_SUCCESS;
    });
    this.ext.registerHandler(54, () => { this.hooks.onExit?.(); return MR_SUCCESS; });
    this.ext.registerHandler(33, () => this.pollTime());
    this.ext.registerHandler(17, (_cpu, mem, args) => this.sprintf(mem, args));
    this.ext.registerHandler(40, (_cpu, mem, args) => this.open(mem, args[0]! >>> 0, args[1]! >>> 0));
    this.ext.registerHandler(41, (_cpu, _mem, args) => this.files.close(args[0]! | 0));
    this.ext.registerHandler(43, (_cpu, mem, args) => this.files.write(mem, args[0]! | 0, args[1]! >>> 0, args[2]! >>> 0));
    this.ext.registerHandler(44, (_cpu, mem, args) => this.files.read(mem, args[0]! | 0, args[1]! >>> 0, args[2]! >>> 0));
    this.ext.registerHandler(45, (_cpu, _mem, args) => this.files.seek(args[0]! | 0, args[1]! | 0, args[2]! | 0));
    this.ext.registerHandler(46, (_cpu, mem, args) => this.files.getLen(readGuestCString(mem, args[0]! >>> 0)));
    this.ext.registerHandler(47, (_cpu, mem, args) => this.files.remove(readGuestCString(mem, args[0]! >>> 0)));
    this.ext.registerHandler(48, (_cpu, mem, [from, to]) => this.files.rename(readGuestCString(mem, from), readGuestCString(mem, to)));
    this.ext.registerHandler(30, (_cpu, mem, args) =>
      this.getCharBitmap(mem, args[0]! >>> 0, args[1]! >>> 0, args[2]! >>> 0, args[3]! >>> 0),
    );
    this.ext.registerHandler(37, (_cpu, _mem, args) => this.plat(args[0]! >>> 0, args[1]! | 0));
    // rxgj aex_t082: closing an already inactive network succeeds.
    this.ext.registerHandler(81, (_cpu, mem, args) => {
      // Initializing the in-memory legacy service transport is synchronous.
      this.networkMode = args[1] ? readGuestCString(mem, args[1]) : "";
      return MR_SUCCESS;
    });
    this.ext.registerHandler(82, () => { this.networkMode = null; this.offlineNetwork.closeAll(); return MR_SUCCESS; });
    this.ext.registerHandler(83, (_cpu, mem, [host]) => this.offlineNetwork.resolve(readGuestCString(mem, host)));
    this.ext.registerHandler(84, (_cpu, _mem, [type, protocol]) => this.offlineNetwork.socket(type, protocol));
    this.ext.registerHandler(85, (_cpu, _mem, [id, ip, port]) => this.offlineNetwork.connect(id, ip, port));
    this.ext.registerHandler(86, (_cpu, _mem, [id]) => this.offlineNetwork.close(id));
    this.ext.registerHandler(87, (_cpu, mem, [id, ptr, length]) => {
      const result = this.offlineNetwork.receive(id, length);
      if (typeof result === "number") return result;
      mem.load(ptr, result);
      return result.length;
    });
    this.ext.registerHandler(89, (_cpu, mem, [id, ptr, length]) =>
      length > 1024 * 1024 ? MR_FAILED : this.offlineNetwork.send(id, mem.slice(ptr, length)));
    for (const slot of [88,90]) this.ext.registerHandler(slot, () => MR_FAILED);
    this.ext.registerHandler(26, (_cpu, mem, args) => this.printf(mem, args));
    this.ext.registerHandler(42, (_cpu, mem, args) => this.info(readGuestCString(mem, args[0]! >>> 0)));
    this.ext.registerHandler(49, (_cpu, mem, args) => this.mkDir(readGuestCString(mem, args[0]! >>> 0)));
    this.ext.registerHandler(35, (_cpu, mem, args) => this.getUserInfo(mem, args[0]! >>> 0));
    this.ext.registerHandler(61, (_cpu, _mem, _args) => this.getNetworkID());
    this.ext.registerHandler(122, (_cpu, _mem, args) => this.drawRect(args));
    this.ext.registerHandler(123, (_cpu, mem, args) => this.drawText(mem, args));
    this.ext.registerHandler(29, (_cpu, mem, args) => this.drawBitmap(mem, args));
    this.ext.registerHandler(120, (cpu, mem, args) => this.drawBitmapRop(cpu.r[13] >>> 0, mem, args));
    this.ext.registerHandler(121, (cpu, mem, args) => this.drawBitmapEx(cpu.r[13] >>> 0, mem, args));
    this.ext.registerHandler(124, (cpu, mem, args) => this.bitmapCheck(cpu.r[13] >>> 0, mem, args));
    this.ext.registerHandler(126, (_cpu, mem, args) => this.wstrlen(mem, args[0]! >>> 0));
    this.ext.registerHandler(31, (_cpu, _mem, args) => this.timerStart(args[0]! >>> 0));
    this.ext.registerHandler(32, (_cpu, _mem, _args) => this.timerStop());
    this.ext.registerHandler(80, (_cpu, mem, args) => this.getScreenInfo(mem, args[0]! >>> 0));
    this.ext.registerHandler(78, (_cpu, _mem, _args) => this.winCreate());
    this.ext.registerHandler(79, (_cpu, _mem, args) => this.winRelease(args[0]! | 0));
    this.ext.registerHandler(57, (_cpu, mem, args) => this.playSound(mem, args[0]! | 0, args[1]! >>> 0, args[2]! >>> 0, args[3]! | 0));
    this.ext.registerHandler(58, (_cpu, _mem, args) => this.stopSound(args[0]! | 0));
    this.ext.registerHandler(119, (_cpu, _mem, args) => this.drawPoint(args[0]! | 0, args[1]! | 0, args[2]! >>> 0));
    this.ext.registerHandler(145, (_cpu, _mem, args) => this.platDrawChar(args[0]! >>> 0, args[1]! | 0, args[2]! | 0, args[3]! >>> 0));
    this.ext.registerHandler(113, (_cpu, mem, args) => guestMd5Init(mem, args[0]));
    this.ext.registerHandler(114, (_cpu, mem, args) => guestMd5Append(mem, args[0], args[1], args[2]));
    this.ext.registerHandler(115, (_cpu, mem, args) => guestMd5Finish(mem, args[0], args[1]));
    if (!this.hooks.onUnknownSlot) return;
    const orig = this.ext.table.dispatch.bind(this.ext.table);
    this.ext.table.dispatch = (cpu, mem, pc) => {
      const n = tableSlotIndex(pc);
      if (n >= 0 && n < EXT_TABLE_COUNT && this.ext.table.isExec(n) && !this.ext.table.handlers[n]) {
        this.unknownRequiredSlot = n;
        this.hooks.onUnknownSlot!(n);
      }
      orig(cpu, mem, pc);
    };
  }

  /**
   * table[130] = `asm_mr_TestCom` = `_mr_TestCom`.
   *
   * This is rxgj FULL compatibility behavior (`#ifdef MR_PLAT_DRAWTEXT` case 7:
   * `return input1`). It is not claimed to be universal Mythroad behavior.
   *
   * rxgj `aex_t130`: `_mr_TestCom(NULL, (int)r1, (int)r2)`. Guest r0 / r3 ignored.
   * Only `input0 == 7` is implemented. Any other case is UnknownAbiError.
   */
  testCom(args: Uint32Array): number {
    const input0 = args[1]! | 0;
    const input1 = args[2]! | 0;
    if (input0 === MR_TESTCOM_CASE7) return input1;
    throw new UnknownAbiError(`unsupported TestCom case ${input0}`, {
      family: "_mr_TestCom",
      code: input0,
      caller: "ext",
    });
  }

  /**
   * table[33] = `asm_mr_getTime` = `mr_getTime`.
   *
   * `uint32 mr_getTime(void)` — zero-argument ABI. Incoming R0–R3 / stack
   * are not parameters.
   *
   * mr_getTime is backed by flymrp's deterministic runtime clock.
   * The ARM ABI exposes the low 32 bits as uint32 milliseconds.
   * It does not use JavaScript wall-clock time.
   *
   * Guest-observable epoch is elapsed monotonic milliseconds since
   * runtime start (`MythroadRuntime.clock` initial value 0). This is
   * the rxgj FULL guest semantic (`get_uptime_ms() - dsmStartTime`),
   * not a second host-timestamp layer.
   */
  getTime(): number {
    const n = this.hooks.getClock ? this.hooks.getClock() : this.clock;
    return n >>> 0;
  }

  /** Synchronous guest delay loops must see elapsed time, even before they
   * return to the host event loop. Charge only uninterrupted clock polling at
   * a deterministic 16.384 MIPS; normal event-driven time stays unchanged. */
  private pollTime(): number {
    const serial = this.ext.guestCallSerial, bridge = this.ext.bridgeCalls;
    const instructions = this.ext.cpu.insnCount, last = this.lastTimeCall;
    if (serial === last.serial && bridge === last.bridge + 1) {
      this.pollingInstructions += Math.max(0, instructions - last.instructions);
      const ms = Math.floor(this.pollingInstructions / 16384);
      if (ms) {
        this.pollingInstructions %= 16384;
        if (this.hooks.onSleep) this.hooks.onSleep(ms);
        else if (!this.hooks.getClock) this.clock += ms;
      }
    } else this.pollingInstructions = 0;
    this.lastTimeCall = { serial, bridge, instructions };
    return this.getTime();
  }

  /**
   * table[17] = `sprintf_`.
   *
   * `int sprintf_(char *buffer, const char *format, ...)`.
   *
   * Supports literals, signed/unsigned decimal, hex, strings, chars and percent.
   *
   * Guest-aware: R0=buffer, R1=format, first vararg=R2 (`format_arm` first_arg=2).
   * `%d` is guest ARM int32. Unsupported conversions throw UnknownAbiError.
   * Does not construct a host va_list.
   *
   * Return is bytes written excluding the trailing NUL (mpaland `sprintf_`).
   */
  sprintf(mem: GuestMemory, args: Uint32Array): number {
    return guestSprintf(mem, args[0]! >>> 0, args[1]! >>> 0, (index) => aapcsSprintfVararg(args, index));
  }

  /**
   * table[38] = `asm_mr_platEx` = `mr_platEx`.
   *
   * This is rxgj FULL compatibility behavior for the observed
   * `mr_platEx(0x4c6, NULL, 0, NULL, NULL, NULL)` call.
   *
   * It is not claimed to implement the complete `mr_platEx` API
   * or universal Mythroad platform behavior. No backlight / Canvas /
   * DOM / device side effects.
   *
   * AAPCS: r0=code r1=input r2=input_len r3=output [sp]=output_len [sp+4]=cb.
   * Implemented: `0x4c6` → `MR_SUCCESS`; `1204` `dsmSwitchPath` (Y/Z/X/A/B/C).
   * Other platEx codes remain UnknownAbiError.
   */
  platEx(mem: GuestMemory, args: Uint32Array): number {
    const code = args[0]! >>> 0;
    const input = args[1]! >>> 0;
    const inputLen = args[2]! >>> 0;
    const output = args[3]! >>> 0;
    const outputLen = args[4]! >>> 0;
    const cb = args[5]! >>> 0;
    if (code === MR_PLATEX_CODE_4C6 || code === 1223) {
      void input;
      void inputLen;
      void output;
      void outputLen;
      void cb;
      return MR_SUCCESS;
    }
    if (code === MR_SWITCHPATH) return this.switchPath(mem, input, inputLen, output, outputLen);
    if (code === 1014) {
      const screen = this.hooks.getScreen?.() ?? this.screen;
      const size = (inputLen | 0) > 0 ? inputLen : screen.width * screen.height * 4;
      const p = this.malloc(size);
      if (!p) return MR_FAILED;
      if (output) mem.write32(output, p);
      if (outputLen) mem.write32(outputLen, size);
      return MR_SUCCESS;
    }
    if (code === 1015) return this.free(input, inputLen);
    // Optional platform billing-state query; this offline host does not take over.
    if (code === 0x90004) return MR_IGNORE;
    const mediaResult = this.media.dispatch(mem, code, input, inputLen, output, outputLen);
    if (mediaResult !== null) return mediaResult;
    if (code === 1207) {
      if (!input || !output) return MR_FAILED;
      const chars: number[] = [];
      for (let p = input; ; p += 2) { const c = (mem.read8(p) << 8) | mem.read8(p + 1); if (!c) break; chars.push(c); }
      const bytes = ucs2ToGbk(chars);
      let destination = mem.read32(output);
      if (!destination) {
        destination = this.malloc(bytes.length + 1);
        if (!destination) return MR_FAILED;
        mem.write32(output, destination);
        if (outputLen) mem.write32(outputLen, bytes.length + 1);
      }
      mem.load(destination, bytes); mem.write8(destination + bytes.length, 0);
      return MR_SUCCESS;
    }
    if (code === 1305) {
      if (!input || !output || !outputLen) return MR_FAILED;
      const drive = mem.read8(input) & ~32;
      const values = drive === 65 ? [1722, 1024, 1271, 1024] : drive === 66 ? [95, 1024, 77, 1024] :
        drive === 67 ? [1874, 1048576, 1873, 1048576] : null;
      if (!values) return MR_IGNORE;
      this.diskInfoAddr ||= this.ext.alloc(16);
      values.forEach((n, i) => mem.write32(this.diskInfoAddr + i * 4, n));
      mem.write32(output, this.diskInfoAddr); mem.write32(outputLen, 16);
      return MR_SUCCESS;
    }
    const message = `unsupported mr_platEx code ${code}`;
    this.hooks.onUnknownAbi?.({ family: "mr_platEx", code, message });
    throw new UnknownAbiError(message, {
      family: "mr_platEx",
      code,
      caller: "ext",
    });
  }

  /**
   * rxgj `dsmSwitchPath`. LIVE: `'Y'` query then `'B:/mythroad/'` switch.
   * `'Y'` writes a guest buffer and `*output` / `*output_len`.
   * `'B'`/`'A'`/`'C'`/`'X'`/`'Z'` only update `dsmWorkPath` (no output).
   * Unknown letters return `MR_IGNORE` (source default). Not a host filesystem.
   */
  switchPath(mem: GuestMemory, input: number, inputLen: number, output: number, outputLen: number): number {
    if (!input) {
      const message = "unsupported mr_platEx SWITCHPATH input";
      this.hooks.onUnknownAbi?.({ family: "mr_platEx", code: MR_SWITCHPATH, message });
      throw new UnknownAbiError(message, { family: "mr_platEx", code: MR_SWITCHPATH, caller: "ext" });
    }
    const cmd = mem.read8(input >>> 0) & 0xff;
    const suffix = (inputLen | 0) > 3 ? readGuestCString(mem, (input + 3) >>> 0) : "";
    switch (cmd) {
      case 0x59:
      case 0x79:
        return this.switchPathQuery(mem, output, outputLen);
      case 0x5a:
      case 0x7a:
        this.setWorkPath(MYTHROAD_WORK_PATH);
        return MR_SUCCESS;
      case 0x58:
      case 0x78:
        this.setWorkPath(DSM_DRIVE_X);
        return MR_SUCCESS;
      case 0x41:
      case 0x61:
        this.setWorkPath((inputLen | 0) > 3 ? DSM_DRIVE_A + suffix : DSM_DRIVE_A);
        return MR_SUCCESS;
      case 0x42:
      case 0x62:
        this.setWorkPath((inputLen | 0) > 3 ? DSM_DRIVE_B + suffix : DSM_DRIVE_B);
        return MR_SUCCESS;
      case 0x43:
      case 0x63:
        this.setWorkPath((inputLen | 0) > 3 ? suffix : "./");
        return MR_SUCCESS;
      default:
        return MR_IGNORE;
    }
  }

  /** rxgj `SetDsmWorkPath`: unify separators and force a trailing `/`. */
  setWorkPath(path: string): void {
    let out = "";
    let slash = false;
    for (let i = 0; i < path.length; i++) {
      const ch = path.charCodeAt(i);
      if (ch === 0x2f || ch === 0x5c) {
        if (!slash) {
          out += "/";
          slash = true;
        }
      } else {
        out += path[i]!;
        slash = false;
      }
    }
    if (out && !out.endsWith("/")) out += "/";
    this.workPath = out;
  }

  /** rxgj `dsmSwitchPath('Y')` hide-drive vs default `c:/%s` formatting. */
  formatSwitchPathY(): string {
    const hide = this.workPath.indexOf(DSM_HIDE_DRIVE);
    if (hide >= 0) {
      const rest = this.workPath.slice(hide + DSM_HIDE_DRIVE.length);
      const drive = rest.charAt(0);
      const tail = rest.slice(2);
      return tail ? `${drive}:/${tail}` : `${drive}:/`;
    }
    return `c:/${this.workPath}`;
  }

  /**
   * table[122] = `asm_DrawRect` = `DrawRect`.
   * C: `void DrawRect(int16 x, int16 y, int16 w, int16 h, uint8 r, uint8 g, uint8 b)`.
   * AAPCS: r0-r3 = x,y,w,h; [sp]/[sp+4]/[sp+8] = r,g,b.
   * Fills the RGB565 screen cache. Return is `MR_SUCCESS` (void ABI, r0 unused).
   */
  drawRect(args: Uint32Array): number {
    const x = args[0]! | 0;
    const y = args[1]! | 0;
    const w = args[2]! | 0;
    const h = args[3]! | 0;
    const r = args[4]! & 0xff;
    const g = args[5]! & 0xff;
    const b = args[6]! & 0xff;
    const screen = this.hooks.getScreen?.() ?? this.screen;
    screen.drawRect(x, y, w, h, r, g, b);
    this.hooks.onDrawRect?.(x, y, w, h, r, g, b);
    return MR_SUCCESS;
  }

  /**
   * table[123] = `asm_DrawText` = `_DrawText`.
   * C: `int32 _DrawText(char *text, int16 x, int16 y, uint8 r,g,b, int is_unicode, uint16 font)`.
   * LIVE: unicode=1, font=0, white text at (88,160).
   * unicode=0 is GBK → UCS-2 (`c2u`) then the same glyph index.
   * Glyphs come from loaded `gb16.uc2`, else generated stand-ins. Return is 0.
   */
  drawText(mem: GuestMemory, args: Uint32Array): number {
    const text = args[0]! >>> 0;
    if (!text) return 0;
    const x = args[1]! | 0;
    const y = args[2]! | 0;
    const r = args[3]! & 0xff;
    const g = args[4]! & 0xff;
    const b = args[5]! & 0xff;
    const unicode = args[6]! | 0;
    const font = args[7]! & 0xffff;
    void font;
    const screen = this.hooks.getScreen?.() ?? this.screen;
    const chars = unicode ? readUcs2Be(mem, text) : gbkBytesToUcs2(readGuestBytes(mem, text));
    let preview = "";
    let chx = asI16(x);
    const chy = asI16(y);
    for (const ch of chars) {
      preview += String.fromCharCode(ch);
      const glyph = gb16Glyph(ch);
      screen.drawGlyph(chx, chy, glyph.width, glyph.height, glyph.bits, r, g, b);
      chx += glyph.width;
    }
    this.hooks.onDrawText?.(preview, asI16(x), chy, r, g, b, unicode ? 1 : 0, font);
    return 0;
  }

  /**
   * table[29] = `asm_mr_drawBitmap` = `mr_drawBitmap`.
   * C: `void mr_drawBitmap(uint16 *bmp, int16 x, int16 y, uint16 w, uint16 h)`.
   * LIVE: bmp=NULL, (0,0,240,h) — guest `mr_screenBuf` is the host RGB565 cache,
   * so NULL presents that cache (not a silent success with no frame).
   * Non-NULL copies guest RGB565 then presents.
   */
  drawBitmap(mem: GuestMemory, args: Uint32Array): number {
    const bmp = args[0]! >>> 0;
    const x = asI16(args[1]!);
    const y = asI16(args[2]!);
    const w = args[3]! & 0xffff;
    const h = args[4]! & 0xffff;
    const screen = this.hooks.getScreen?.() ?? this.screen;
    if (bmp && bmp !== this.screenAddr) {
      const maxW = Math.min(w, Math.max(0, screen.width - Math.max(x, 0)));
      const maxH = Math.min(h, Math.max(0, screen.height - Math.max(y, 0)));
      for (let row = 0; row < maxH; row++) {
        const dy = y + row;
        if (dy < 0 || dy >= screen.height) continue;
        for (let col = 0; col < maxW; col++) {
          const dx = x + col;
          if (dx < 0 || dx >= screen.width) continue;
          screen.pixels[dy * screen.width + dx] = mem.read16((bmp + (row * w + col) * 2) >>> 0);
        }
      }
    }
    this.hooks.onFlush?.(x, y, w, h);
    return MR_SUCCESS;
  }

  /**
   * table[120] = `asm_DrawBitmap` = `_DrawBitmap`.
   * C: `void _DrawBitmap(uint16 *p, int16 x, int16 y, uint16 w, uint16 h,
   * uint16 rop, uint16 transcoler, int16 sx, int16 sy, int16 mw)`.
   * AAPCS: r0-r3 = p,x,y,w; [sp+0..+20] = h,rop,trans,sx,sy,mw.
   * Writes the host RGB565 cache only. Present is table[29], not this slot.
   * Guest `p` is never a host pointer.
   */
  drawBitmapRop(sp: number, mem: GuestMemory, args: Uint32Array): number {
    const p = args[0]! >>> 0;
    const x = asI16(args[1]!);
    const y = asI16(args[2]!);
    const w = args[3]! & 0xffff;
    const stack = sp >>> 0;
    const h = mem.read32(stack) & 0xffff;
    const rop = mem.read32((stack + 4) >>> 0) & 0xffff;
    const trans = mem.read32((stack + 8) >>> 0) & 0xffff;
    const sx = asI16(mem.read32((stack + 12) >>> 0));
    const sy = asI16(mem.read32((stack + 16) >>> 0));
    const mw = asI16(mem.read32((stack + 20) >>> 0));
    if (!p) return MR_SUCCESS;
    const screen = this.hooks.getScreen?.() ?? this.screen;
    screen.drawBitmapRop((i) => mem.read16((p + (i << 1)) >>> 0), x, y, w, h, rop, trans, sx, sy, mw);
    return MR_SUCCESS;
  }

  /**
   * table[121] = `asm_DrawBitmapEx` = `_DrawBitmapEx`.
   * C: `void _DrawBitmapEx(mr_bitmapDrawSt *src, mr_bitmapDrawSt *dst,
   * uint16 w, uint16 h, mr_transMatrixSt *pTrans, uint16 transcoler)`.
   * AAPCS: r0=src* r1=dst* r2=w r3=h; [sp]=pTrans* [sp+4]=transcolor.
   * Guest descriptors are 12 / 10 bytes (32-bit `p`). `I==0` is a no-op.
   * Screen-sized dest also writes the host RGB565 cache.
   */
  lastDrawBitmapEx: { src: number; dst: number; w: number; h: number; rop: number } | null = null;
  drawBitmapEx(_sp: number, mem: GuestMemory, args: Uint32Array): number {
    const srcDesc = args[0]! >>> 0;
    const dstDesc = args[1]! >>> 0;
    const w = args[2]! & 0xffff;
    const h = args[3]! & 0xffff;
    const transDesc = args[4]! >>> 0;
    const trans = args[5]! & 0xffff;
    this.lastDrawBitmapEx = { src: srcDesc, dst: dstDesc, w, h, rop: 0 };
    if (!srcDesc || !dstDesc || !transDesc) return MR_SUCCESS;
    const srcP = mem.read32(srcDesc);
    const srcW = mem.read16((srcDesc + 4) >>> 0);
    const srcH = mem.read16((srcDesc + 6) >>> 0);
    const srcX = mem.read16((srcDesc + 8) >>> 0);
    const srcY = mem.read16((srcDesc + 10) >>> 0);
    const dstP = mem.read32(dstDesc);
    const dstW = mem.read16((dstDesc + 4) >>> 0);
    const dstH = mem.read16((dstDesc + 6) >>> 0);
    const dstX = mem.read16((dstDesc + 8) >>> 0);
    const dstY = mem.read16((dstDesc + 10) >>> 0);
    const A = asI16(mem.read16(transDesc));
    const B = asI16(mem.read16((transDesc + 2) >>> 0));
    const C = asI16(mem.read16((transDesc + 4) >>> 0));
    const D = asI16(mem.read16((transDesc + 6) >>> 0));
    const rop = mem.read16((transDesc + 8) >>> 0);
    this.lastDrawBitmapEx.rop = rop;
    if (!srcP || !dstP || !srcW || !srcH || !dstW || !dstH) return MR_SUCCESS;
    if (srcX > srcW || srcY > srcH || w > srcW - srcX || h > srcH - srcY) return MR_SUCCESS;
    const screen = this.hooks.getScreen?.() ?? this.screen;
    const mirrorScreen = dstW === screen.width && dstH === screen.height;
    try {
      screen.drawBitmapEx(
        (sx, sy) => mem.read16((srcP + ((sy * srcW + sx) << 1)) >>> 0),
        srcX,
        srcY,
        (dx, dy, color) => {
          if (dx < 0 || dy < 0 || dx >= dstW || dy >= dstH) return;
          mem.write16((dstP + ((dy * dstW + dx) << 1)) >>> 0, color);
          if (mirrorScreen) screen.drawPoint565(dx, dy, color);
        },
        dstW,
        dstH,
        dstX,
        dstY,
        w,
        h,
        A,
        B,
        C,
        D,
        rop,
        trans,
      );
    } catch {
      /* unmapped dest/src: official would fault; keep the ABI call SUCCESS */
    }
    return MR_SUCCESS;
  }

  /**
   * table[124] = `asm_BitmapCheck` = `_BitmapCheck`.
   * C: `int _BitmapCheck(uint16 *p, int16 x, int16 y, uint16 w, uint16 h,
   * uint16 transcoler, uint16 color_check)`.
   * AAPCS: r0=p r1=x r2=y r3=w; [sp]=h [sp+4]=trans [sp+8]=color_check.
   * Counts non-transparent source pixels whose host cache is not `color_check`.
   */
  bitmapCheck(sp: number, mem: GuestMemory, args: Uint32Array): number {
    const p = args[0]! >>> 0;
    const x = asI16(args[1]!);
    const y = asI16(args[2]!);
    const w = args[3]! & 0xffff;
    const h = mem.read32(sp >>> 0) & 0xffff;
    const trans = mem.read32((sp + 4) >>> 0) & 0xffff;
    const colorCheck = mem.read32((sp + 8) >>> 0) & 0xffff;
    if (!p) return 0;
    const screen = this.hooks.getScreen?.() ?? this.screen;
    return screen.bitmapCheck((i) => mem.read16((p + (i << 1)) >>> 0), x, y, w, h, trans, colorCheck);
  }

  /**
   * table[126] = `wstrlen`. C: `int wstrlen(char *txt)`.
   * Count UCS-2 bytes until a 0x0000 pair. NULL → 0.
   */
  wstrlen(mem: GuestMemory, addr: number): number {
    if (!addr) return 0;
    let i = 0;
    try {
      while (i < 0x10000) {
        const a = mem.read8((addr + i) >>> 0);
        const b = mem.read8((addr + i + 1) >>> 0);
        if (a === 0 && b === 0) break;
        i += 2;
      }
    } catch {
      return i;
    }
    return i;
  }

  /**
   * table[78] = `mr_winCreate`. rxgj `dsm.c` / `aex_t078` return `MR_IGNORE`.
   * No host window. Not a GUI implementation.
   */
  winCreate(): number {
    return MR_IGNORE;
  }

  /**
   * table[79] = `mr_winRelease`. rxgj `dsm.c` / `aex_t079` return `MR_IGNORE`.
   */
  winRelease(win: number): number {
    void win;
    return MR_IGNORE;
  }

  /**
   * table[57] = `asm_mr_playSound` = `mr_playSound`.
   * C: `int32 mr_playSound(int type, const void *data, uint32 dataLen, int32 loop)`.
   * AAPCS: r0=type r1=guest data* r2=len r3=loop.
   * rxgj `aex_t057` copies the guest stream and plays it. Node has no device;
   * return `MR_SUCCESS`, record the guest pointer, and optionally copy bytes
   * for a host hook. Unmapped `data*` does not fail the ABI call.
   */
  lastPlaySound: { type: number; data: number; len: number; loop: number } | null = null;
  lastPlaySoundBytes: Uint8Array | null = null;
  playSound(mem: GuestMemory, type: number, data: number, len: number, loop: number): number {
    const kind = type | 0;
    const ptr = data >>> 0;
    const n = len >>> 0;
    const repeat = loop | 0;
    this.lastPlaySound = { type: kind, data: ptr, len: n, loop: repeat };
    let bytes: Uint8Array | null = null;
    if (ptr && n && n <= PLAYSOUND_COPY_MAX) {
      try {
        bytes = mem.slice(ptr, n);
      } catch {
        bytes = null;
      }
    }
    this.lastPlaySoundBytes = bytes;
    this.hooks.onPlaySound?.(kind, bytes, repeat);
    return MR_SUCCESS;
  }

  /**
   * table[58] = `asm_mr_stopSound` = `mr_stopSound`.
   * C: `int32 mr_stopSound(int type)`. AAPCS: r0=type. Leftover r1–r3 ignored.
   * rxgj `aex_t058` forwards to the host player. Return SUCCESS either way.
   */
  lastStopSound: { type: number } | null = null;
  stopSound(type: number): number {
    const kind = type | 0;
    this.lastStopSound = { type: kind };
    this.hooks.onStopSound?.(kind);
    return MR_SUCCESS;
  }

  /**
   * table[119] = `asm_DrawPoint` = `_DrawPoint`.
   * C: `void _DrawPoint(int16 x, int16 y, uint16 nativecolor)`.
   * AAPCS: r0=x r1=y r2=RGB565. Leftover r3 ignored.
   * rxgj `aex_t119` writes the screen cache and returns `MR_SUCCESS`.
   * Out of bounds is a no-op, still SUCCESS.
   */
  lastDrawPoint: { x: number; y: number; color: number } | null = null;
  drawPoint(x: number, y: number, native: number): number {
    const x0 = asI16(x);
    const y0 = asI16(y);
    const color = native & 0xffff;
    this.lastDrawPoint = { x: x0, y: y0, color };
    const screen = this.hooks.getScreen?.() ?? this.screen;
    screen.drawPoint565(x0, y0, color);
    return MR_SUCCESS;
  }

  /**
   * table[145] = `asm_mr_platDrawChar` = `mr_platDrawChar`.
   * C: `void mr_platDrawChar(uint16 ch, int32 x, int32 y, uint32 color)`.
   * AAPCS: r0=ch r1=x r2=y r3=color. rxgj `aex_t145` returns 0.
   * `color` is used as RGB565 (`uint16`), matching `dsm.c` / `xl_font_sky16_drawChar`.
   * No `fontSize` argument; rxgj uses the last `mr_getCharBitmap` size.
   * Without `gb12.uc2` that is always gb16. Glyphs are generated, not UC2.
   */
  lastPlatDrawChar: { ch: number; x: number; y: number; color: number } | null = null;
  lastFontSize = 1;
  platDrawChar(ch: number, x: number, y: number, color: number): number {
    const id = ch & 0xffff;
    const native = color & 0xffff;
    this.lastPlatDrawChar = { ch: id, x: asI16(x), y: asI16(y), color: native };
    const glyph = gb16Glyph(id);
    const r5 = (native >>> 11) & 0x1f;
    const g6 = (native >>> 5) & 0x3f;
    const b5 = native & 0x1f;
    const screen = this.hooks.getScreen?.() ?? this.screen;
    screen.drawGlyph(
      asI16(x),
      asI16(y),
      glyph.width,
      glyph.height,
      glyph.bits,
      (r5 << 3) | (r5 >>> 2),
      (g6 << 2) | (g6 >>> 4),
      (b5 << 3) | (b5 >>> 2),
    );
    return 0;
  }

  switchPathQuery(mem: GuestMemory, output: number, outputLen: number): number {
    const path = this.formatSwitchPathY();
    if (!this.switchPathAddr) this.switchPathAddr = this.ext.alloc(DSM_SWITCHPATH_BUF);
    if (!this.switchPathAddr) return MR_FAILED;
    writeFixedCString(mem, this.switchPathAddr, path, DSM_SWITCHPATH_BUF);
    if (output) mem.write32(output >>> 0, this.switchPathAddr);
    if (outputLen) mem.write32(outputLen >>> 0, path.length);
    return MR_SUCCESS;
  }

  /**
   * table[37] = `asm_mr_plat` = `mr_plat`.
   *
   * C: `int32 mr_plat(int32 code, int32 param)`.
   * rxgj FULL: `1206` → `MR_CHINESE`; `1205` → `MR_TOUCH_SCREEN`.
   * Android rxgj returns `MR_NORMAL_SCREEN` for 1205; this is not that fork.
   * It is not the complete `mr_plat` API.
   */
  /**
   * table[31] = `asm_mr_timerStart` = `mr_timerStart`.
   *
   * C: `int32 mr_timerStart(uint16 t)`.
   * rxgj host always returns `MR_SUCCESS`. One-shot flymrp timer.
   * Timer owner is current || active || wrapper (not full LR-range resolve).
   */
  timerStart(interval: number): number {
    const t = interval & 0xffff;
    const now = this.hooks.getClock ? this.hooks.getClock() : this.clock;
    const state = this.hooks.getMrState?.() ?? MR_STATE_RUN;
    const timer = this.hooks.getTimer?.() ?? this.localTimer;
    if (timer.start(now, t, "dealtimer", state)) this.recordTimerOwner();
    return MR_SUCCESS;
  }

  /**
   * table[32] = `asm_mr_timerStop` = `mr_timerStop`.
   *
   * C: `int32 mr_timerStop(void)`. Zero-arg. LIVE R0 is the stub leftover.
   * rxgj host always returns `MR_SUCCESS` and clears timer owner.
   */
  timerStop(): number {
    const timer = this.hooks.getTimer?.() ?? this.localTimer;
    timer.stop();
    this.ext.owners.timer = { p: 0, helper: 0 };
    return MR_SUCCESS;
  }

  /**
   * rxgj `arm_ext_record_timer_owner` fallback: current || active || wrapper.
   * Full LR-range resolve is not implemented.
   */
  recordTimerOwner(): void {
    const o = this.ext.owners;
    const p = (o.current.p || o.active.p || o.wrapper.p) >>> 0;
    const helper = (o.current.helper || o.active.helper || o.wrapper.helper) >>> 0;
    if (p && helper) this.ext.owners.timer = { p, helper };
  }

  /**
   * table[80] = `asm_mr_getScreenInfo` = `mr_getScreenInfo`.
   *
   * C: `int32 mr_getScreenInfo(mr_screeninfo *s)`.
   * Writes width/height/bit=16. NULL → `MR_FAILED` (rxgj `aex_t080`).
   */
  getScreenInfo(mem: GuestMemory, addr: number): number {
    if (!addr) return MR_FAILED;
    const screen = this.hooks.getScreen?.() ?? this.screen;
    mem.write32(addr >>> 0, screen.width >>> 0);
    mem.write32((addr + 4) >>> 0, screen.height >>> 0);
    mem.write32((addr + 8) >>> 0, 16);
    return MR_SUCCESS;
  }

  plat(code: number, param: number): number {
    if (code === 1001) return this.offlineNetwork.state(param);
    if (code === 1101 || code === 1011 || code === 1215) return MR_IGNORE;
    if (code === 1214) return MR_SUCCESS; // Enable key-release events (always supported).
    if (code === 1302) { this.volume = Math.max(0, Math.min(100, param)); return MR_SUCCESS; }
    if ((code >>> 0) === MR_GET_HANDSET_LG) return MR_CHINESE;
    if ((code >>> 0) === MR_CHECK_TOUCH) return MR_TOUCH_SCREEN;
    // rxgj dsm.c: SMS-centre query is asynchronous (MR_WAITING); no SMS is sent.
    if ((code >>> 0) === 1106) return 2;
    const message = `unsupported mr_plat code ${code}`;
    this.hooks.onUnknownAbi?.({ family: "mr_plat", code, message });
    throw new UnknownAbiError(message, {
      family: "mr_plat",
      code,
      caller: "ext",
    });
  }

  /**
   * table[40] = `asm_mr_open` = `mr_open`.
   *
   * `int32 mr_open(const char *filename, uint32 mode)`.
   *
   * Pack name + RDONLY is the current-pack alias. Other names go to AppFS.
   * Missing EFS without CREATE returns 0. Pack write modes stay UnknownAbiError.
   */
  open(mem: GuestMemory, nameAddr: number, mode: number): number {
    try {
      const name = readGuestCString(mem, nameAddr), result = this.files.open(name, mode >>> 0);
      if (!result && /(^|[\\/])plugins[\\/]/i.test(name) && this.missingComponents.size < 128) this.missingComponents.add(name);
      return result;
    } catch (e) {
      if (e instanceof UnknownAbiError) {
        this.hooks.onUnknownAbi?.({
          family: e.family,
          code: typeof e.code === "number" ? e.code : 40,
          message: e.message,
        });
      }
      throw e;
    }
  }

  /**
   * table[42] = `asm_mr_info` = `mr_info`.
   *
   * C: `int32 mr_info(const char *filename)`.
   * Returns `MR_IS_FILE` / `MR_IS_DIR` / `MR_IS_INVALID`.
   *
   * Only the current pack name is a known file (the RDONLY alias).
   * Archive members are source payloads, not installed EFS files
   * (rxgj aex_t042). Missing / unbacked names, including `dbglog.txt`,
   * return `MR_IS_INVALID`. Not a writable VFS.
   */
  lastInfo = "";
  lastMkDir = "";
  info(filename: string): number {
    this.lastInfo = filename;
    const pack = this.hooks.getPack?.();
    if (pack && filename && filename === pack.name) return MR_IS_FILE;
    const local = this.appFs.info(filename);
    if (local !== null) return local;
    return MR_IS_INVALID;
  }

  /**
   * table[49] = `asm_mr_mkDir` = `mr_mkDir`.
   *
   * C: `int32 mr_mkDir(const char *name)`.
   * Creates an in-memory directory in the writable EFS namespace.
   * Does not touch the current pack or archive members.
   */
  mkDir(name: string): number {
    this.lastMkDir = name;
    return this.appFs.mkdir(name);
  }

  /**
   * table[35] = `asm_mr_getUserInfo` = `mr_getUserInfo`.
   *
   * C: `int32 mr_getUserInfo(mr_userinfo *info)`.
   * AAPCS: r0 = guest pointer. NULL → `MR_FAILED`.
   *
   * Layout CONFIRMED (`mrporting.h`): IMEI16 + IMSI16 + manu8 + type8 + ver u32 + spare12.
   * Values come from flymrp `DeviceProfile`. Default IMEI/IMSI stay zeros.
   * This is flymrp profile / rxgj FULL fill, not a real handset and not universal Mythroad.
   */
  lastUserInfo = 0;
  getUserInfo(mem: GuestMemory, info: number): number {
    const p = info >>> 0;
    this.lastUserInfo = p;
    if (p === 0) return MR_FAILED;
    const profile = this.hooks.getProfile?.() ?? defaultProfile();
    mem.fill(p, 0, MR_USERINFO_SIZE);
    writeFixedCString(mem, p + MR_USERINFO_IMEI_OFF, profile.IMEI, 16);
    writeFixedCString(mem, p + MR_USERINFO_IMSI_OFF, profile.IMSI, 16);
    writeFixedCString(mem, p + MR_USERINFO_MANU_OFF, profile.hsman, 8);
    writeFixedCString(mem, p + MR_USERINFO_TYPE_OFF, profile.hstype, 8);
    mem.write32((p + MR_USERINFO_VER_OFF) >>> 0, packedUserInfoVer(profile.hsver));
    return MR_SUCCESS;
  }

  /**
   * table[61] = `mr_getNetworkID`.
   *
   * C: `int32 mr_getNetworkID(void)`.
   * rxgj `dsm.c` / `aex_t061` return `MR_NET_ID_MOBILE` (0).
   * This is rxgj FULL compatibility, not a real radio / SIM / GPRS stack.
   */
  getNetworkID(): number {
    return MR_NET_ID_MOBILE;
  }

  /**
   * table[30] = `asm_mr_getCharBitmap` = `mr_getCharBitmap`.
   *
   * C: `const char *mr_getCharBitmap(uint16 ch, uint16 fontSize, int *width, int *height)`.
   * AAPCS: r0=ch r1=fontSize r2=width* r3=height*. Return is a guest bitmap pointer.
   *
   * This is rxgj FULL compatibility (`aex_t030` + `dsm.c` sky16).
   * Without `gb12.uc2`, every fontSize uses gb16 metrics (ASCII 8×16, else 16×16).
   * Glyph pixels are generated; they are not `gb16.uc2`. Width/height are CONFIRMED.
   *
   * Bitmap is copied into one reused 32-byte `arm_alloc` slot. Copy length is
   * `((w*h)+7)>>3`, matching rxgj (ASCII copies 16 of 32 bytes).
   */
  /**
   * table[26] = `asm_mr_printf` = `mr_printf`.
   *
   * rxgj `aex_t026`: `format_arm(..., first_arg=1)` then `mr_printf("%s", buf)`.
   * Return is 0. Observed LIVE formats: `SDK%s%dv%d%s)` and `SDKv%d.%d.%d.%2d(%dv%d%s)`.
   * Only literals / `%d` / `%s` / optional width digits are implemented.
   */
  lastPrintf = "";
  printf(mem: GuestMemory, args: Uint32Array): number {
    this.lastPrintf = guestPrintf(mem, args[0]! >>> 0, (i) => aapcsPrintfVararg(args, i));
    return 0;
  }

  getCharBitmap(mem: GuestMemory, ch: number, fontSize: number, widthAddr: number, heightAddr: number): number {
    this.lastFontSize = fontSize & 0xffff;
    const glyph = gb16Glyph(ch >>> 0);
    if (widthAddr) mem.write32(widthAddr >>> 0, glyph.width);
    if (heightAddr) mem.write32(heightAddr >>> 0, glyph.height);
    if (!this.charBitmapAddr) this.charBitmapAddr = this.ext.alloc(BYTES_PER_CHAR_16) >>> 0;
    if (!this.charBitmapAddr) return 0;
    const n = Math.min(gb16BitmapSize(glyph.width, glyph.height), BYTES_PER_CHAR_16);
    if (n) mem.load(this.charBitmapAddr, glyph.bits.subarray(0, n));
    return this.charBitmapAddr;
  }

  /**
   * `memset2(s, c, count)` — mythroad.c `_mr_c_function_table[14]`.
   * Returns `s` (guest dest). `c` is the low 8 bits. `count` is size_t.
   */
  memset(mem: GuestMemory, dest: number, value: number, length: number): number {
    const dst = dest >>> 0;
    const n = length >>> 0;
    if (n) mem.fill(dst, value & 0xff, n);
    return dst;
  }

  /**
   * `memcpy2(dest, src, count)` — mythroad.c `_mr_c_function_table[3]`.
   * Forward byte copy. Not memmove. count==0 does not touch pointers.
   */
  memcpy(mem: GuestMemory, dest: number, src: number, count: number): number {
    return memcpy2(mem, dest, src, count);
  }

  /**
   * `strcmp2(cs, ct)` — mythroad.c `_mr_c_function_table[10]`.
   * unsigned-char byte compare. Returns -1 / 0 / 1.
   */
  strcmp(mem: GuestMemory, cs: number, ct: number): number {
    return strcmp2(mem, cs, ct);
  }

  malloc(size: number): number {
    const want = size >>> 0;
    if (want === 0) return 0;
    const aligned = Math.ceil(want / 8) * 8;
    let guestAddr = this.heap?.malloc(aligned) ?? 0;
    if (!guestAddr) {
      if ((this.ext.heapTop >>> 0) + aligned > EXT_STACK_ADDR) return 0;
      guestAddr = this.ext.alloc(want) >>> 0;
    }
    const rec: AllocRecord = { size: want, alignedSize: aligned, guestAddr, owner: this.owner, live: true };
    this.allocs.push(rec);
    this.hooks.onAlloc?.(rec);
    return guestAddr;
  }

  /**
   * table[1] = `asm_mr_free` = `mr_free`.
   *
   * C: `void mr_free(void *p, uint32 len)`. Guest-visible aex R0 is always
   * `MR_SUCCESS` (0), including NULL / unknown / already-free.
   *
   * Retires an owned allocation and returns pool blocks to the guest free
   * list. The registry owns the size even when the caller passes a stale hint.
   */
  free(p: number, len: number): number {
    const ptr = p >>> 0;
    void len;
    if (ptr === 0) return MR_SUCCESS;
    const rec = this.allocs.find((a) => a.live && a.guestAddr === ptr);
    if (!rec) return MR_SUCCESS;
    rec.live = false;
    this.heap?.free(ptr, rec.alignedSize);
    return MR_SUCCESS;
  }

  liveAllocs(): AllocRecord[] {
    return this.allocs.filter((a) => a.live);
  }

  readFile(mem: GuestMemory, nameAddr: number, lenAddr: number, lookfor: number): number {
    const name = readGuestCString(mem, nameAddr);
    if (!name) {
      this.noteRead({ name: "", lookfor, guestAddr: 0, length: 0 });
      return 0;
    }
    // Wrappers build a sequential RAM MRP, publish it through globals 104/105,
    // and temporarily set pack_filename="$" before reading its nested EXT.
    const packName = mem.read32(tableSlotAddr(100));
    if (mem.read8(packName) === 0x24) {
      const p = mem.read32(mem.read32(tableSlotAddr(104)));
      const length = mem.read32(mem.read32(tableSlotAddr(105)));
      if (!p || !length || length > 32 * 1024 * 1024 || ![0, 1, 2].includes(lookfor)) return 0;
      let archive: MRPArchive;
      try { archive = MRPArchive.parse(new Uint8Array(mem.slice(p, length))); }
      catch (e) { if (e instanceof MrpFormatError) return 0; throw e; }
      const entry = archive.findEntry(name);
      if (!entry) return 0;
      if (lookfor === 1) return 1;
      if (lookfor === 2 || !entry.compressed) {
        if (lenAddr) mem.write32(lenAddr, entry.storedLength);
        const address = p + entry.offset;
        this.noteRead({ name, lookfor, guestAddr: address, length: entry.storedLength });
        return address;
      }
      const data = archive.readFile(name);
      const address = this.malloc(data.length);
      if (!address) return 0;
      mem.load(address, data);
      if (lenAddr) mem.write32(lenAddr, data.length);
      this.noteRead({ name, lookfor, guestAddr: address, length: data.length });
      return address;
    }
    if (lookfor === 1) {
      const ok = this.vfs.exists(name) ? 1 : 0;
      this.noteRead({ name, lookfor, guestAddr: ok, length: 0 });
      return ok;
    }
    if (lookfor !== 0 && lookfor !== 2) {
      this.noteRead({ name, lookfor, guestAddr: 0, length: 0 });
      return 0;
    }
    const data = this.vfs.readFile(name);
    if (!data) {
      this.noteRead({ name, lookfor, guestAddr: 0, length: 0 });
      return 0;
    }
    const guestAddr = this.malloc(data.length);
    if (!guestAddr) {
      this.noteRead({ name, lookfor, guestAddr: 0, length: 0 });
      return 0;
    }
    this.ext.mem.load(guestAddr, data);
    if (lenAddr) mem.write32(lenAddr, data.length);
    this.noteRead({ name, lookfor, guestAddr, length: data.length });
    return guestAddr;
  }

  private noteRead(rec: ReadFileRecord): void {
    if (rec.lookfor === 0 && rec.guestAddr && rec.length >= 8) {
      const bytes = this.ext.mem.slice(rec.guestAddr, rec.length);
      if (String.fromCharCode(...bytes.subarray(0, 8)) === "MRPGCMAP") this.lastExtRead = new Uint8Array(bytes);
    }
    this.reads.push(rec);
    this.hooks.onRead?.(rec);
  }
}

/**
 * rxgj `string.c` table[4] memmove2: copy backwards for overlapping dst > src.
 */
export function memmove2(mem: GuestMemory, dest: number, src: number, count: number): number {
  const dst = dest >>> 0;
  const from = src >>> 0;
  const n = count >>> 0;
  if (dst === from) return dst;
  if (dst > from && dst - from < n) {
    for (let i = n; i > 0; i--) mem.write8((dst + i - 1) >>> 0, mem.read8((from + i - 1) >>> 0));
  } else {
    memcpy2(mem, dst, from, n);
  }
  return dst;
}

export function memcpy2(mem: GuestMemory, dest: number, src: number, count: number): number {
  const dst = dest >>> 0;
  const from = src >>> 0;
  const n = count >>> 0;
  if (n === 0) return dst;
  for (let i = 0; i < n; i++) {
    const b = mem.read8((from + i) >>> 0);
    mem.write8((dst + i) >>> 0, b);
  }
  return dst;
}

/**
 * rxgj `string.c` `memcmp2`.
 * `int memcmp2(const void *cs, const void *ct, size_t count)`
 *
 * Compares `unsigned char` and returns the exact first-difference
 * `*su1 - *su2` (not libc-clamped -1/0/1, not `strcmp2`).
 * Early-exits on the first mismatch. `count === 0` returns 0 without
 * accessing either pointer.
 */
export function memcmp2(mem: GuestMemory, cs: number, ct: number, count: number): number {
  const a = cs >>> 0;
  const b = ct >>> 0;
  const n = count >>> 0;
  let res = 0;
  for (let i = 0; i < n; i++) {
    const su1 = mem.read8((a + i) >>> 0) & 0xff;
    const su2 = mem.read8((b + i) >>> 0) & 0xff;
    res = (su1 - su2) | 0;
    if (res !== 0) break;
  }
  return res;
}

/**
 * rxgj `string.c` `strcmp2`. Loads into `unsigned char`, returns -1 / 0 / 1.
 * Stops at the first difference or NUL. Does not decode UTF-8 / locale.
 */
/**
 * rxgj `string.c` `strcpy2`. Copy including the terminating NUL.
 * Returns dest. Overlap is guest-visible self-overwrite, not memmove.
 */
/**
 * rxgj `string.c` `strlen2`. Count bytes until the first NUL.
 * Does not special-case a NULL pointer; guest addr 0 faults like other loads.
 */
/**
 * rxgj `other.c` `atol2` / `atoi2`.
 * Optional leading `-` only. No `+`, no whitespace skip.
 * Accumulates unsigned decimal digits with 32-bit wrap, then applies sign.
 */
export function atoi2(mem: GuestMemory, s: number): number {
  let p = s >>> 0;
  let b = mem.read8(p) & 0xff;
  let neg = 0;
  if (b === 0x2d) {
    neg = 1;
    p = (p + 1) >>> 0;
    b = mem.read8(p) & 0xff;
  }
  let ret = 0;
  for (;;) {
    const d = (b - 0x30) >>> 0;
    if (d > 9) break;
    ret = (Math.imul(ret, 10) + d) >>> 0;
    p = (p + 1) >>> 0;
    b = mem.read8(p) & 0xff;
  }
  return neg ? (-ret | 0) : (ret | 0);
}

export function strlen2(mem: GuestMemory, s: number): number {
  let p = s >>> 0;
  let n = 0;
  while ((mem.read8(p) & 0xff) !== 0) {
    p = (p + 1) >>> 0;
    n++;
  }
  return n;
}

/**
 * rxgj `string.c` `strncpy2`. Copy exactly `count` bytes.
 * After src hits NUL, remaining dest bytes are written as 0 (src is not advanced).
 * `count === 0` returns dest without accessing either pointer.
 */
/**
 * rxgj `string.c` `strcat2`. Append src including NUL onto dest.
 * Returns dest.
 */
export function strcat2(mem: GuestMemory, dest: number, src: number): number {
  const dst = dest >>> 0;
  let to = dst;
  while ((mem.read8(to) & 0xff) !== 0) to = (to + 1) >>> 0;
  let from = src >>> 0;
  for (;;) {
    const b = mem.read8(from) & 0xff;
    mem.write8(to, b);
    if (b === 0) return dst;
    from = (from + 1) >>> 0;
    to = (to + 1) >>> 0;
  }
}

export function strncpy2(mem: GuestMemory, dest: number, src: number, count: number): number {
  const dst = dest >>> 0;
  let from = src >>> 0;
  let to = dst;
  let n = count >>> 0;
  while (n) {
    const b = mem.read8(from) & 0xff;
    mem.write8(to, b);
    if (b !== 0) from = (from + 1) >>> 0;
    to = (to + 1) >>> 0;
    n--;
  }
  return dst;
}

export function strcpy2(mem: GuestMemory, dest: number, src: number): number {
  const dst = dest >>> 0;
  let from = src >>> 0;
  let to = dst;
  for (;;) {
    const b = mem.read8(from) & 0xff;
    mem.write8(to, b);
    if (b === 0) return dst;
    from = (from + 1) >>> 0;
    to = (to + 1) >>> 0;
  }
}

export function strcmp2(mem: GuestMemory, cs: number, ct: number): number {
  let a = cs >>> 0;
  let b = ct >>> 0;
  for (;;) {
    const c1 = mem.read8(a) & 0xff;
    const c2 = mem.read8(b) & 0xff;
    a = (a + 1) >>> 0;
    b = (b + 1) >>> 0;
    if (c1 !== c2) return c1 < c2 ? -1 : 1;
    if (c1 === 0) return 0;
  }
}

export function readGuestCString(mem: GuestMemory, addr: number, max = MR_MAX_FILENAME_SIZE): string {
  if (!addr) return "";
  let s = "";
  for (let i = 0; i < max; i++) {
    const b = mem.read8((addr + i) >>> 0);
    if (b === 0) break;
    s += String.fromCharCode(b);
  }
  return s;
}

function readGuestBytes(mem: GuestMemory, addr: number, max = 1024): Uint8Array {
  if (!addr) return new Uint8Array();
  const tmp = new Uint8Array(max);
  let n = 0;
  for (; n < max; n++) {
    const b = mem.read8((addr + n) >>> 0);
    if (b === 0) break;
    tmp[n] = b;
  }
  return tmp.subarray(0, n);
}

function readUcs2Be(mem: GuestMemory, addr: number, maxChars = 256): number[] {
  const out: number[] = [];
  for (let i = 0; i < maxChars; i++) {
    const off = (addr + i * 2) >>> 0;
    const ch = ((mem.read8(off) << 8) | mem.read8((off + 1) >>> 0)) & 0xffff;
    if (!ch) break;
    out.push(ch);
  }
  return out;
}
