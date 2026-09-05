import { EXT_STACK_ADDR, EXT_TABLE_COUNT, MR_MAX_FILENAME_SIZE, tableSlotIndex } from "../abi/layout.ts";
import type { ExtRuntime } from "../abi/runtime.ts";
import { NativeAbiError, UnknownAbiError } from "../err/errors.ts";
import type { GuestMemory } from "../hot/memory.ts";
import { AppFileSystem } from "./app-fs.ts";
import { MR_CHECK_TOUCH, MR_CHINESE, MR_FAILED, MR_GET_HANDSET_LG, MR_IGNORE, MR_IS_FILE, MR_IS_INVALID, MR_NET_ID_MOBILE, MR_SUCCESS, MR_SWITCHPATH, MR_TOUCH_SCREEN } from "./constants.ts";
import { ScreenBuffer, asI16 } from "./graphics.ts";
import { BYTES_PER_CHAR_16, gb16BitmapSize, gb16Glyph } from "./font.ts";
import { CurrentPackFileBackend, type PackFileSource } from "./pack-file.ts";
import { defaultProfile, type DeviceProfile } from "./profile.ts";
import { aapcsPrintfVararg, aapcsSprintfVararg, guestPrintf, guestSprintf } from "./sprintf.ts";
import type { MythroadVfs } from "./vfs.ts";

/** `sizeof(mr_userinfo)` in `mrporting.h`. */
export const MR_USERINFO_SIZE = 64;
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

/** Observed LIVE `mr_plat` codes. */
export const MR_PLAT_GET_HANDSET_LG = MR_GET_HANDSET_LG;
export const MR_PLAT_CHECK_TOUCH = MR_CHECK_TOUCH;

export type AllocRecord = {
  size: number;
  alignedSize: number;
  guestAddr: number;
  owner: string;
  /** Still owned by the bump registry. Freed records stay in `allocs` but `live` is false. */
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
 * `[33]` (`mr_getTime`) / `[17]` (`sprintf_` literal + `%d` only) /
 * `[40]`/`[44]`/`[45]`/`[41]` current-pack read-only file alias /
 * `[3]` `memcpy2` / `[10]` `strcmp2` / `[9]` `memcmp2` /
 * `[1]` `mr_free` (registry-only; no origin_mem reuse) /
 * `[30]` `mr_getCharBitmap` (rxgj FULL gb16 metrics; generated glyphs).
 * table[100] is a 128-byte `pack_filename` data slot, not a function ABI.
 * Uses the existing EXT bump heap.
 */
export class MrTableBridge {
  readonly allocs: AllocRecord[] = [];
  readonly reads: ReadFileRecord[] = [];
  readonly files: CurrentPackFileBackend;
  readonly appFs = new AppFileSystem();
  unknownRequiredSlot: number | null = null;
  /** rxgj `char_bitmap_addr`: one 32-byte EXT bump slot, reused. */
  charBitmapAddr = 0;
  /** Guest buffer for `mr_platEx(1204)` `'Y'` path query. Reused. */
  switchPathAddr = 0;
  /** rxgj `dsmWorkPath`. Starts at `mythroad/`. */
  workPath = MYTHROAD_WORK_PATH;
  /** Isolated-test screen when `hooks.getScreen` is absent. */
  screen = new ScreenBuffer(240, 320);
  /**
   * Isolated-test clock when `hooks.getClock` is absent.
   * Production always reads `MythroadRuntime.clock` via `getClock`.
   */
  clock = 0;

  constructor(
    readonly ext: ExtRuntime,
    readonly vfs: MythroadVfs,
    readonly owner: string,
    readonly hooks: {
      onUnknownSlot?: (n: number) => void;
      onAlloc?: (rec: AllocRecord) => void;
      onRead?: (rec: ReadFileRecord) => void;
      getClock?: () => number;
      getPack?: () => PackFileSource | null;
      getProfile?: () => DeviceProfile;
      getScreen?: () => ScreenBuffer;
      onDrawRect?: (x: number, y: number, w: number, h: number, r: number, g: number, b: number) => void;
      onDrawText?: (text: string, x: number, y: number, r: number, g: number, b: number, unicode: number, font: number) => void;
      onFlush?: (x: number, y: number, w: number, h: number) => void;
      onUnknownAbi?: (info: { family: string; code: string | number; message: string }) => void;
    } = {},
  ) {
    this.files = new CurrentPackFileBackend(() => this.hooks.getPack?.() ?? null);
  }

  install(): void {
    this.ext.registerHandler(0, (_cpu, _mem, args) => this.malloc(args[0]! >>> 0));
    this.ext.registerHandler(1, (_cpu, _mem, args) => this.free(args[0]! >>> 0, args[1]! >>> 0));
    this.ext.registerHandler(3, (_cpu, mem, args) => memcpy2(mem, args[0]!, args[1]!, args[2]!));
    this.ext.registerHandler(5, (_cpu, mem, args) => strcpy2(mem, args[0]!, args[1]!));
    this.ext.registerHandler(6, (_cpu, mem, args) => strncpy2(mem, args[0]!, args[1]!, args[2]!));
    this.ext.registerHandler(7, (_cpu, mem, args) => strcat2(mem, args[0]!, args[1]!));
    this.ext.registerHandler(15, (_cpu, mem, args) => strlen2(mem, args[0]!));
    this.ext.registerHandler(18, (_cpu, mem, args) => atoi2(mem, args[0]!));
    this.ext.registerHandler(9, (_cpu, mem, args) => memcmp2(mem, args[0]!, args[1]!, args[2]!));
    this.ext.registerHandler(10, (_cpu, mem, args) => strcmp2(mem, args[0]!, args[1]!));
    this.ext.registerHandler(14, (_cpu, mem, args) => this.memset(mem, args[0]!, args[1]!, args[2]!));
    this.ext.registerHandler(125, (_cpu, mem, args) => this.readFile(mem, args[0]! >>> 0, args[1]! >>> 0, args[2]! | 0));
    this.ext.registerHandler(130, (_cpu, _mem, args) => this.testCom(args));
    this.ext.registerHandler(38, (_cpu, mem, args) => this.platEx(mem, args));
    this.ext.registerHandler(33, (_cpu, _mem, _args) => this.getTime());
    this.ext.registerHandler(17, (_cpu, mem, args) => this.sprintf(mem, args));
    this.ext.registerHandler(40, (_cpu, mem, args) => this.open(mem, args[0]! >>> 0, args[1]! >>> 0));
    this.ext.registerHandler(41, (_cpu, _mem, args) => this.files.close(args[0]! | 0));
    this.ext.registerHandler(44, (_cpu, mem, args) => this.files.read(mem, args[0]! | 0, args[1]! >>> 0, args[2]! >>> 0));
    this.ext.registerHandler(45, (_cpu, _mem, args) => this.files.seek(args[0]! | 0, args[1]! | 0, args[2]! | 0));
    this.ext.registerHandler(30, (_cpu, mem, args) =>
      this.getCharBitmap(mem, args[0]! >>> 0, args[1]! >>> 0, args[2]! >>> 0, args[3]! >>> 0),
    );
    this.ext.registerHandler(37, (_cpu, _mem, args) => this.plat(args[0]! >>> 0, args[1]! | 0));
    this.ext.registerHandler(26, (_cpu, mem, args) => this.printf(mem, args));
    this.ext.registerHandler(42, (_cpu, mem, args) => this.info(readGuestCString(mem, args[0]! >>> 0)));
    this.ext.registerHandler(49, (_cpu, mem, args) => this.mkDir(readGuestCString(mem, args[0]! >>> 0)));
    this.ext.registerHandler(35, (_cpu, mem, args) => this.getUserInfo(mem, args[0]! >>> 0));
    this.ext.registerHandler(61, (_cpu, _mem, _args) => this.getNetworkID());
    this.ext.registerHandler(122, (_cpu, _mem, args) => this.drawRect(args));
    this.ext.registerHandler(123, (_cpu, mem, args) => this.drawText(mem, args));
    this.ext.registerHandler(29, (_cpu, mem, args) => this.drawBitmap(mem, args));
    this.ext.registerHandler(78, (_cpu, _mem, _args) => this.winCreate());
    this.ext.registerHandler(79, (_cpu, _mem, args) => this.winRelease(args[0]! | 0));
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

  /**
   * table[17] = `sprintf_`.
   *
   * `int sprintf_(char *buffer, const char *format, ...)`.
   *
   * Only the observed guest sprintf subset consisting of
   * literal bytes and `%d` is currently implemented.
   *
   * Guest-aware: R0=buffer, R1=format, first vararg=R2 (`format_arm` first_arg=2).
   * `%d` is guest ARM int32. Other specifiers throw UnknownAbiError.
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
    if (code === MR_PLATEX_CODE_4C6) {
      void input;
      void inputLen;
      void output;
      void outputLen;
      void cb;
      return MR_SUCCESS;
    }
    if (code === MR_SWITCHPATH) return this.switchPath(mem, input, inputLen, output, outputLen);
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
   * Glyphs are generated gb16, not device UC2. Return is 0.
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
    let preview = "";
    let chx = asI16(x);
    const chy = asI16(y);
    if (unicode) {
      for (let off = 0; off < 512; off += 2) {
        const ch = ((mem.read8((text + off) >>> 0) << 8) | mem.read8((text + off + 1) >>> 0)) & 0xffff;
        if (!ch) break;
        preview += String.fromCharCode(ch);
        const glyph = gb16Glyph(ch);
        screen.drawGlyph(chx, chy, glyph.width, glyph.height, glyph.bits, r, g, b);
        chx += glyph.width;
      }
    } else {
      preview = readGuestCString(mem, text);
      let i = 0;
      while (i < preview.length) {
        const b0 = preview.charCodeAt(i) & 0xff;
        let ch = b0;
        if (b0 >= 128 && i + 1 < preview.length) {
          ch = ((b0 << 8) | (preview.charCodeAt(i + 1) & 0xff)) & 0xffff;
          i += 2;
        } else {
          i += 1;
        }
        if (!ch) break;
        const glyph = gb16Glyph(ch);
        screen.drawGlyph(chx, chy, glyph.width, glyph.height, glyph.bits, r, g, b);
        chx += glyph.width;
      }
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
    if (bmp) {
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
  plat(code: number, param: number): number {
    void param;
    if ((code >>> 0) === MR_GET_HANDSET_LG) return MR_CHINESE;
    if ((code >>> 0) === MR_CHECK_TOUCH) return MR_TOUCH_SCREEN;
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
   * Only `filename === current packName` and `mode === MR_FILE_RDONLY` (1)
   * are implemented. Other names/modes are unsupported flymrp ABI
   * (`UnknownAbiError`), not a guest-visible open failure (0).
   */
  open(mem: GuestMemory, nameAddr: number, mode: number): number {
    try {
      return this.files.open(readGuestCString(mem, nameAddr), mode >>> 0);
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
    void fontSize;
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
    const aligned = (want + 7) & ~7;
    if ((this.ext.heapTop >>> 0) + aligned > EXT_STACK_ADDR) return 0;
    const guestAddr = this.ext.alloc(want) >>> 0;
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
   * This validates and retires flymrp bump allocations but does not
   * reproduce rxgj origin_mem free-list reuse/coalescing.
   *
   * Exact live match: `guestAddr === p` and `size === len`. Then mark
   * not live. Does not zero, poison, write `{next,len}`, reuse the
   * address, or move the bump pointer.
   *
   * Known live pointer + wrong len is a flymrp strict trap
   * (`NativeAbiError`), not simulated free-list corruption.
   */
  free(p: number, len: number): number {
    const ptr = p >>> 0;
    const n = len >>> 0;
    if (ptr === 0) return MR_SUCCESS;
    const rec = this.allocs.find((a) => a.live && a.guestAddr === ptr);
    if (!rec) return MR_SUCCESS;
    if (rec.size !== n) {
      throw new NativeAbiError(
        `mr_free length mismatch: ptr=0x${ptr.toString(16)} len=${n} allocated=${rec.size}`,
      );
    }
    rec.live = false;
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
    this.reads.push(rec);
    this.hooks.onRead?.(rec);
  }
}

/**
 * rxgj `string.c` `memcpy2`. Forward `read8` then `write8` per byte.
 * Overlap is guest-visible self-overwrite, not memmove / TypedArray.set.
 * `count === 0` returns dest without accessing either pointer.
 */
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
