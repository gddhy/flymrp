import { LuaRuntimeError, NativeAbiError, VfsError } from "../err/errors.ts";
import { LuaState } from "../lua/state.ts";
import { TAG_NUMBER, TAG_TABLE, type NativeFunction } from "../lua/types.ts";
import {
  BITMAPMAX,
  BM_COPY,
  BM_TRANSPARENT,
  MR_FAILED,
  MR_FILE_CREATE,
  MR_FILE_RDONLY,
  MR_FILE_STATE_CLOSED,
  MR_FILE_STATE_NIL,
  MR_FILE_STATE_OPEN,
  MR_FILE_WRONLY,
  MR_FLAGS_BI,
  MR_FONT_MEDIUM,
  MR_SEEK_SET,
  MR_SUCCESS,
  MR_VERSION,
  SHORT_TYPENAMES,
  SPRITEMAX,
  TILEMAX,
} from "./constants.ts";
import { persistRoot, unpersistRoot } from "./persist.ts";
import { gb16Glyph } from "./font.ts";
import { lcgNext } from "./profile.ts";
import type { MythroadRuntime } from "./runtime.ts";

export function installNatives(rt: MythroadRuntime): void {
  const L = rt.lua.L;
  const reg = (name: string, fn: NativeFunction) => L.register(name, fn);

  reg("_strCom", rt.strCom);
  reg("TestCom1", rt.strCom);

  const com = makeCom(rt);
  reg("_com", com);
  reg("TestCom", com);

  const sys = makeGetSysInfo(rt);
  reg("GetSysInfo", sys);
  const dt = makeGetDatetime(rt);
  reg("GetDatetime", dt);

  const tStart = makeTimerStart(rt);
  const tStop = makeTimerStop(rt);
  reg("TimerStart", tStart);
  reg("_timerStart", tStart);
  reg("TimerStop", tStop);
  reg("_timerStop", tStop);

  const drawText = makeDrawText(rt);
  reg("_drawText", drawText);
  reg("DrawText", drawText);
  const drawRect = makeDrawRect(rt);
  reg("_drawRect", drawRect);
  reg("DrawRect", drawRect);
  const clear = makeClear(rt);
  reg("_clearScr", clear);
  reg("ClearScreen", clear);
  const dispUp = makeDispUp(rt);
  reg("_dispUp", dispUp);
  const dispUpEx = makeDispUpEx(rt);
  reg("_dispUpEx", dispUpEx);
  reg("DispUpEx", dispUpEx);
  const eff = makeEff(rt);
  reg("_effSetCon", eff);
  reg("EffSetCon", eff);
  const line = makeLine(rt);
  reg("_drawLine", line);
  reg("DrawLine", line);
  const point = makePoint(rt);
  reg("_drawPoint", point);
  reg("DrawPoint", point);

  reg("BitmapLoad", makeBitmapLoad(rt));
  reg("BitmapShow", makeBitmapShow(rt));
  reg("BitmapNew", makeBitmapNew(rt));
  reg("BitmapDraw", makeBitmapDraw(rt));
  reg("SpriteSet", makeSpriteSet(rt));
  reg("SpriteDraw", makeSpriteDraw(rt));
  reg("TileSet", makeTileSet(rt));
  reg("TileSetRect", makeTileSetRect(rt));
  reg("TileDraw", makeTileDraw(rt));

  const save = makeSaveTable(rt);
  const load = makeLoadTable(rt);
  reg("SaveTable", save);
  reg("LoadTable", load);
  const runFile = makeRunFile(rt);
  reg("RunFile", runFile);
  reg("_runFile", runFile);

  const exitFn = makeExit(rt);
  reg("Exit", exitFn);
  reg("_exit", exitFn);

  reg("_t", typeShort);
  reg("type", typeLong);
  reg("_gc", makeGc(rt));
  reg("_rand", makeRand(rt));
  reg("GetRand", makeRand(rt));
  reg("_mod", modFn);
  reg("mod", modFn);
  reg("_and", andFn);
  reg("_or", orFn);
  reg("_xor", xorFn);
  reg("_not", notFn);

  installFileLib(rt);
  installSysLib(rt, sys, dt);
}

function makeCom(rt: MythroadRuntime): NativeFunction {
  return (L) => {
    const a0 = L.optNumber(1, 0) | 0;
    const a1 = L.optNumber(2, 0) | 0;
    let ret = 0;
    switch (a0) {
      case 1:
        ret = rt.clock | 0;
        break;
      case 100:
        ret = rt.profile.memMin;
        break;
      case 101:
        ret = rt.profile.memTop;
        break;
      case 102:
        ret = rt.profile.memLeft;
        break;
      case 400:
        rt.sleeps.push(a1);
        break;
      case 401: {
        ret = rt.screenW;
        rt.screenW = a1;
        break;
      }
      case 403:
        rt.gcThreshold = a1;
        rt.gcCalls++;
        break;
      case 406: {
        ret = rt.screenH;
        rt.screenH = a1;
        break;
      }
      case 3629:
        if (a1 === 2913) rt.bi |= MR_FLAGS_BI;
        break;
      default:
        return rt.unknownAbi("_com", a0, L);
    }
    L.pushInteger(ret);
    return 1;
  };
}

function makeGetSysInfo(rt: MythroadRuntime): NativeFunction {
  return (L) => {
    L.optNumber(1, MR_FONT_MEDIUM);
    const id = L.pushTable();
    L.setTableNum(id, "vmver", rt.profile.vmver || MR_VERSION);
    L.setTableNum(id, "ScreenW", rt.screenW);
    L.setTableNum(id, "ScreenH", rt.screenH);
    L.setTableNum(id, "scrw", rt.screenW);
    L.setTableNum(id, "scrh", rt.screenH);
    L.setTableNum(id, "ChineseWidth", rt.profile.chw);
    L.setTableNum(id, "ChineseHigh", rt.profile.chh);
    L.setTableNum(id, "chw", rt.profile.chw);
    L.setTableNum(id, "chh", rt.profile.chh);
    L.setTableNum(id, "EnglishWidth", rt.profile.ascw);
    L.setTableNum(id, "EnglishHigh", rt.profile.asch);
    L.setTableNum(id, "ascw", rt.profile.ascw);
    L.setTableNum(id, "asch", rt.profile.asch);
    L.setTableStr(id, "PackName", rt.packName);
    L.setTableStr(id, "packname", rt.packName);
    L.setTableStr(id, "hsman", rt.profile.hsman);
    L.setTableStr(id, "hstype", rt.profile.hstype);
    L.setTableStr(id, "IMEI", rt.profile.IMEI);
    L.setTableStr(id, "IMSI", rt.profile.IMSI);
    L.setTableNum(id, "hsver", rt.profile.hsver);
    return 1;
  };
}

function makeGetDatetime(rt: MythroadRuntime): NativeFunction {
  return (L) => {
    const d = rt.profile.datetime;
    const id = L.pushTable();
    L.setTableNum(id, "year", d.year);
    L.setTableNum(id, "mon", d.month);
    L.setTableNum(id, "day", d.day);
    L.setTableNum(id, "hour", d.hour);
    L.setTableNum(id, "min", d.minute);
    L.setTableNum(id, "sec", d.second);
    return 1;
  };
}

function makeTimerStart(rt: MythroadRuntime): NativeFunction {
  return (L) => {
    L.optNumber(1, 0);
    const ms = L.optNumber(2, 0) | 0;
    const name = L.optString(3, "dealtimer");
    rt.timers.start(rt.clock, ms, name, rt.state);
    return 0;
  };
}

function makeTimerStop(rt: MythroadRuntime): NativeFunction {
  return (L) => {
    L.optNumber(1, 0);
    rt.timers.stop();
    return 0;
  };
}

function makeDrawText(rt: MythroadRuntime): NativeFunction {
  return (L) => {
    const text = L.optString(1, "");
    const x = L.optNumber(2, 0) | 0;
    const y = L.optNumber(3, 0) | 0;
    const r = L.optNumber(4, 0) | 0;
    const g = L.optNumber(5, 0) | 0;
    const b = L.optNumber(6, 0) | 0;
    const uni = L.optNumber(7, 0) ? 1 : 0;
    const font = L.optNumber(8, MR_FONT_MEDIUM) | 0;
    let chx = x;
    for (let i = 0; i < text.length; i++) {
      const glyph = gb16Glyph(text.charCodeAt(i));
      rt.screen.drawGlyph(chx, y, glyph.width, glyph.height, glyph.bits, r, g, b);
      chx += glyph.width;
    }
    rt.gfx.drawText(text, x, y, r, g, b, uni, font);
    return 0;
  };
}

function makeDrawRect(rt: MythroadRuntime): NativeFunction {
  return (L) => {
    const x = L.optNumber(1, 0) | 0;
    const y = L.optNumber(2, 0) | 0;
    const w = L.optNumber(3, 0) | 0;
    const h = L.optNumber(4, 0) | 0;
    const r = L.optNumber(5, 0) | 0;
    const g = L.optNumber(6, 0) | 0;
    const b = L.optNumber(7, 0) | 0;
    rt.screen.drawRect(x, y, w, h, r, g, b);
    rt.gfx.drawRect(x, y, w, h, r, g, b);
    return 0;
  };
}

function makeClear(rt: MythroadRuntime): NativeFunction {
  return (L) => {
    const r = L.optNumber(1, 0) | 0;
    const g = L.optNumber(2, 0) | 0;
    const b = L.optNumber(3, 0) | 0;
    rt.screen.drawRect(0, 0, rt.screenW, rt.screenH, r, g, b);
    rt.gfx.clear(r, g, b);
    return 0;
  };
}

function makeDispUp(rt: MythroadRuntime): NativeFunction {
  return (L) => {
    rt.gfx.flush(
      L.optNumber(1, 0) | 0,
      L.optNumber(2, 0) | 0,
      L.optNumber(3, 0) | 0,
      L.optNumber(4, 0) | 0,
      L.optNumber(5, BITMAPMAX) | 0,
    );
    return 0;
  };
}

function makeDispUpEx(rt: MythroadRuntime): NativeFunction {
  return (L) => {
    if (rt.canRun()) {
      rt.gfx.flush(L.optNumber(1, 0) | 0, L.optNumber(2, 0) | 0, L.optNumber(3, 0) | 0, L.optNumber(4, 0) | 0, BITMAPMAX);
    }
    return 0;
  };
}

function makeEff(rt: MythroadRuntime): NativeFunction {
  return (L) => {
    rt.gfx.effSetCon(
      L.optNumber(1, 0) | 0,
      L.optNumber(2, 0) | 0,
      L.optNumber(3, 0) | 0,
      L.optNumber(4, 0) | 0,
      L.optNumber(5, 0) | 0,
      L.optNumber(6, 0) | 0,
      L.optNumber(7, 0) | 0,
    );
    return 0;
  };
}

function makeLine(rt: MythroadRuntime): NativeFunction {
  return (L) => {
    rt.gfx.drawLine(
      L.optNumber(1, 0) | 0,
      L.optNumber(2, 0) | 0,
      L.optNumber(3, 0) | 0,
      L.optNumber(4, 0) | 0,
      L.optNumber(5, 0) | 0,
      L.optNumber(6, 0) | 0,
      L.optNumber(7, 0) | 0,
    );
    return 0;
  };
}

function makePoint(rt: MythroadRuntime): NativeFunction {
  return (L) => {
    rt.gfx.drawPoint(
      L.optNumber(1, 0) | 0,
      L.optNumber(2, 0) | 0,
      L.optNumber(3, 0) | 0,
      L.optNumber(4, 0) | 0,
      L.optNumber(5, 0) | 0,
    );
    return 0;
  };
}

function makeExit(rt: MythroadRuntime): NativeFunction {
  return () => {
    rt.state = 4; // MR_STATE_STOP
    rt.exited = true;
    throw new LuaRuntimeError("Exiting...");
  };
}

function typeShort(L: LuaState): number {
  const i = L.checkAny(1);
  L.pushString(SHORT_TYPENAMES[L.tags[i]!] ?? "no value");
  return 1;
}

function typeLong(L: LuaState): number {
  const i = L.checkAny(1);
  const names = ["nil", "boolean", "object", "number", "string", "table", "function", "object", "thread"];
  L.pushString(names[L.tags[i]!] ?? "no value");
  return 1;
}

function makeGc(rt: MythroadRuntime): NativeFunction {
  return (L) => {
    rt.gcThreshold = L.optNumber(1, 0) | 0;
    rt.gcCalls++;
    return 0;
  };
}

function makeRand(rt: MythroadRuntime): NativeFunction {
  return (L) => {
    const n = L.optNumber(1, 0) | 0;
    if (n === 0) throw new LuaRuntimeError("_rand modulo 0");
    rt.randSeed = lcgNext(rt.randSeed);
    L.pushInteger((rt.randSeed >>> 0) % n);
    return 1;
  };
}

function modFn(L: LuaState): number {
  const n = L.optNumber(1, 0) | 0;
  const m = L.optNumber(2, 0) | 0;
  if (m === 0) throw new LuaRuntimeError("_mod modulo 0");
  L.pushInteger(n % m);
  return 1;
}
function andFn(L: LuaState): number {
  L.pushInteger((L.optNumber(1, 0) | 0) & (L.optNumber(2, 0) | 0));
  return 1;
}
function orFn(L: LuaState): number {
  L.pushInteger((L.optNumber(1, 0) | 0) | (L.optNumber(2, 0) | 0));
  return 1;
}
function xorFn(L: LuaState): number {
  L.pushInteger((L.optNumber(1, 0) | 0) ^ (L.optNumber(2, 0) | 0));
  return 1;
}
function notFn(L: LuaState): number {
  L.pushInteger(L.optNumber(1, 0) | 0 ? 0 : 1);
  return 1;
}

function installFileLib(rt: MythroadRuntime): void {
  const L = rt.lua.L;
  const fileId = L.newTable();
  L.setTableFn(fileId, "open", (Ls) => fileOpen(rt, Ls));
  L.setTableFn(fileId, "close", (Ls) => fileClose(rt, Ls));
  L.setTableFn(fileId, "state", (Ls) => fileState(rt, Ls));
  L.setTableFn(fileId, "readAll", (Ls) => fileReadAll(rt, Ls));
  L.setGlobal("file", TAG_TABLE, fileId);
}

function fdOf(L: LuaState): number {
  const i = L.checkArg(1);
  if (L.tags[i] === TAG_NUMBER) return L.nums[i]!;
  if (L.tags[i] === TAG_TABLE) {
    const t = L.tables[L.nums[i]!]!;
    const v = t.getStr(L.internStr("_fd"));
    if (v.tag !== TAG_NUMBER) throw new VfsError("file handle missing _fd");
    return v.num;
  }
  throw new NativeAbiError("argument #1 must be a file handle");
}

function pushHandle(rt: MythroadRuntime, L: LuaState, fd: number): void {
  const id = L.pushTable();
  L.setTableNum(id, "_fd", fd);
  L.setTableFn(id, "read", (Ls) => fileRead(rt, Ls));
  L.setTableFn(id, "seek", (Ls) => fileSeek(rt, Ls));
  L.setTableFn(id, "write", (Ls) => fileWrite(rt, Ls));
  L.setTableFn(id, "close", (Ls) => fileClose(rt, Ls));
}

function fileOpen(rt: MythroadRuntime, L: LuaState): number {
  const name = L.checkString(1).s;
  const mode = L.optNumber(2, MR_FILE_RDONLY) | 0;
  const fd = rt.vfs.open(name, mode);
  if (fd === 0) {
    L.pushNil();
    L.pushString(`file err: ${name}: ${rt.vfs.lastErrno}`);
    L.pushInteger(rt.vfs.lastErrno);
    return 3;
  }
  pushHandle(rt, L, fd);
  return 1;
}

function fileClose(rt: MythroadRuntime, L: LuaState): number {
  const fd = fdOf(L);
  const ok = rt.vfs.close(fd) === 0;
  if (ok) {
    L.pushBoolean(true);
    return 1;
  }
  L.pushNil();
  L.pushString(`file err:${rt.vfs.lastErrno}`);
  L.pushInteger(rt.vfs.lastErrno);
  return 3;
}

function fileState(rt: MythroadRuntime, L: LuaState): number {
  const i = L.absindex(1);
  if (i >= L.top) {
    L.pushInteger(MR_FILE_STATE_NIL);
    return 1;
  }
  try {
    const fd = fdOf(L);
    L.pushInteger(rt.vfs.fdOpen[fd] ? MR_FILE_STATE_OPEN : MR_FILE_STATE_CLOSED);
  } catch {
    L.pushInteger(MR_FILE_STATE_NIL);
  }
  return 1;
}

function fileReadAll(rt: MythroadRuntime, L: LuaState): number {
  const name = L.checkString(1).s;
  const data = rt.vfs.readFile(name);
  if (!data) return 0;
  L.pushString(data);
  return 1;
}

function fileRead(rt: MythroadRuntime, L: LuaState): number {
  const fd = fdOf(L);
  const n = L.optNumber(2, 0x7fffffff) | 0;
  L.pushString(rt.vfs.read(fd, n));
  return 1;
}

function fileSeek(rt: MythroadRuntime, L: LuaState): number {
  const fd = fdOf(L);
  const whence = L.optNumber(2, MR_SEEK_SET) | 0;
  const offset = L.optNumber(3, 0) | 0;
  const op = rt.vfs.seek(fd, offset, whence);
  if (op !== 0) {
    L.pushNil();
    L.pushString(`file err:${rt.vfs.lastErrno}`);
    L.pushInteger(rt.vfs.lastErrno);
    return 3;
  }
  L.pushInteger(offset);
  return 1;
}

function fileWrite(rt: MythroadRuntime, L: LuaState): number {
  const fd = fdOf(L);
  const s = L.checkString(2).s;
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;
  rt.vfs.write(fd, bytes);
  L.pushBoolean(true);
  return 1;
}

function installSysLib(rt: MythroadRuntime, sysInfo: NativeFunction, dt: NativeFunction): void {
  const L = rt.lua.L;
  const id = L.newTable();
  L.setTableFn(id, "getInfo", sysInfo);
  L.setTableFn(id, "datetime", dt);
  L.setTableFn(id, "getuptime", (Ls) => {
    Ls.pushInteger(rt.clock | 0);
    return 1;
  });
  L.setTableFn(id, "getFileLen", (Ls) => {
    Ls.pushInteger(rt.vfs.size(Ls.checkString(1).s));
    return 1;
  });
  L.setTableFn(id, "getfilelen", (Ls) => {
    Ls.pushInteger(rt.vfs.size(Ls.checkString(1).s));
    return 1;
  });
  L.setTableFn(id, "getFileInfo", (Ls) => {
    Ls.pushInteger(rt.vfs.info(Ls.checkString(1).s));
    return 1;
  });
  L.setTableFn(id, "getfileinfo", (Ls) => {
    Ls.pushInteger(rt.vfs.info(Ls.checkString(1).s));
    return 1;
  });
  L.setGlobal("sys", TAG_TABLE, id);
}

function makeSaveTable(rt: MythroadRuntime): NativeFunction {
  return (L) => {
    const filename = L.optString(3, "");
    L.settop(2);
    L.checkTable(1);
    const permsId = L.nums[L.absindex(1)]!;
    const root = L.slot(L.absindex(2));
    const fd = rt.vfs.open(filename, MR_FILE_WRONLY | MR_FILE_CREATE);
    if (fd === 0) return 0;
    const bytes = persistRoot(L, permsId, root);
    rt.vfs.write(fd, bytes);
    rt.vfs.close(fd);
    L.settop(0);
    L.pushInteger(MR_SUCCESS);
    return 1;
  };
}

function makeLoadTable(rt: MythroadRuntime): NativeFunction {
  return (L) => {
    const filename = L.optString(2, "");
    L.settop(2);
    L.settop(1);
    const permsId = L.nums[L.absindex(1)]!;
    L.checkTable(1);
    const fd = rt.vfs.open(filename, MR_FILE_RDONLY);
    if (fd === 0) {
      L.settop(1);
      return 1;
    }
    const data = rt.vfs.read(fd, 0x7fffffff);
    rt.vfs.close(fd);
    const obj = unpersistRoot(L, permsId, data);
    L.settop(0);
    L.pushSlot(obj);
    return 1;
  };
}

function makeRunFile(rt: MythroadRuntime): NativeFunction {
  return (L) => {
    const pack = L.optString(1, "");
    const file = L.optString(2, "");
    const param = L.optString(3, "");
    rt.requestRunFile(pack, file, param);
    return 0;
  };
}

function makeBitmapLoad(rt: MythroadRuntime): NativeFunction {
  return (L) => {
    const i = L.optNumber(1, 0) | 0;
    const filename = L.optString(2, "");
    const x = L.optNumber(3, 0) | 0;
    const y = L.optNumber(4, 0) | 0;
    const w = L.optNumber(5, 0) | 0;
    const h = L.optNumber(6, 0) | 0;
    const maxw = L.optNumber(7, 0) | 0;
    if (!(rt.bi & MR_FLAGS_BI)) throw new LuaRuntimeError(`BitmapLoad:cannot read File "${filename}"!`);
    if (i > BITMAPMAX) throw new LuaRuntimeError(`BitmapLoad:index ${i} invalid!`);
    if (filename.charCodeAt(0) === 42) return 0;
    if (!rt.vfs.exists(filename)) throw new LuaRuntimeError(`BitmapLoad ${i}:cannot read "${filename}"!`);
    rt.bitmaps[i] = { w, h, loaded: true, name: filename };
    rt.gfx.image({ op: "image", sub: "load", i, filename, x, y, w, h, maxw });
    return 0;
  };
}

function makeBitmapShow(rt: MythroadRuntime): NativeFunction {
  return (L) => {
    const i = L.optNumber(1, 0) | 0;
    const x = L.optNumber(2, 0) | 0;
    const y = L.optNumber(3, 0) | 0;
    const rop = L.optNumber(4, BM_COPY) | 0;
    const sx = L.optNumber(5, 0) | 0;
    const sy = L.optNumber(6, 0) | 0;
    const slot = rt.bitmaps[i];
    const w = L.absindex(7) < L.top && L.optNumber(7, -1) !== -1 ? L.optNumber(7, -1) | 0 : (slot?.w ?? -1);
    const h = L.absindex(8) < L.top && L.optNumber(8, -1) !== -1 ? L.optNumber(8, -1) | 0 : (slot?.h ?? -1);
    rt.gfx.image({ op: "image", sub: "show", i, x, y, w, h, rop, sx, sy });
    return 0;
  };
}

function makeBitmapNew(rt: MythroadRuntime): NativeFunction {
  return (L) => {
    const i = L.optNumber(1, 0) | 0;
    const w = L.optNumber(2, 0) | 0;
    const h = L.optNumber(3, 0) | 0;
    if (i > BITMAPMAX) throw new LuaRuntimeError(`BitmapNew:index ${i} invalid!`);
    rt.bitmaps[i] = { w, h, loaded: true, name: "" };
    rt.gfx.image({ op: "image", sub: "new", i, w, h });
    return 0;
  };
}

function makeBitmapDraw(rt: MythroadRuntime): NativeFunction {
  return (L) => {
    const di = L.optNumber(1, 0) | 0;
    const dx = L.optNumber(2, 0) | 0;
    const dy = L.optNumber(3, 0) | 0;
    const si = L.optNumber(4, 0) | 0;
    if (si > BITMAPMAX || di > BITMAPMAX) throw new LuaRuntimeError(`BitmapDraw:index ${di} or ${si} invalid!`);
    rt.gfx.image({
      op: "image",
      sub: "draw",
      i: di,
      di,
      si,
      x: dx,
      y: dy,
      sx: L.optNumber(5, 0) | 0,
      sy: L.optNumber(6, 0) | 0,
      w: L.optNumber(7, 0) | 0,
      h: L.optNumber(8, 0) | 0,
      rop: L.optNumber(13, BM_COPY) | 0,
    });
    return 0;
  };
}

function makeSpriteSet(rt: MythroadRuntime): NativeFunction {
  return (L) => {
    const i = L.optNumber(1, 0) | 0;
    const h = L.optNumber(2, 0) | 0;
    if (i >= SPRITEMAX) throw new LuaRuntimeError(`SpriteSet:index ${i} invalid!`);
    rt.sprites[i] = { h };
    return 0;
  };
}

function makeSpriteDraw(rt: MythroadRuntime): NativeFunction {
  return (L) => {
    const i = L.optNumber(1, 0) | 0;
    const spriteindex = L.optNumber(2, 0) | 0;
    const x = L.optNumber(3, 0) | 0;
    const y = L.optNumber(4, 0) | 0;
    const mod = L.optNumber(5, BM_TRANSPARENT) | 0;
    rt.gfx.sprite({ op: "sprite", i, spriteindex, x, y, mod });
    return 0;
  };
}

function makeTileSet(rt: MythroadRuntime): NativeFunction {
  return (L) => {
    const i = L.optNumber(1, 0) | 0;
    if (i >= TILEMAX) throw new LuaRuntimeError("TileSet:tile index out of rang!");
    const x = L.optNumber(2, 0) | 0;
    const y = L.optNumber(3, 0) | 0;
    const w = L.optNumber(4, 0) | 0;
    const h = L.optNumber(5, 0) | 0;
    const tileh = L.optNumber(6, 0) | 0;
    rt.tiles[i] = { x, y, w, h, tileh, x1: 0, y1: 0, x2: 0, y2: 0 };
    rt.gfx.tile({ op: "tile", sub: "set", i, x, y, w, h, tileh });
    return 0;
  };
}

function makeTileSetRect(rt: MythroadRuntime): NativeFunction {
  return (L) => {
    const i = L.optNumber(1, 0) | 0;
    if (i >= TILEMAX) throw new LuaRuntimeError("TileSet:tile index out of rang!");
    const x1 = L.optNumber(2, 0) | 0;
    const y1 = L.optNumber(3, 0) | 0;
    const x2 = L.optNumber(4, 0) | 0;
    const y2 = L.optNumber(5, 0) | 0;
    const t = rt.tiles[i] ?? { x: 0, y: 0, w: 0, h: 0, tileh: 0, x1, y1, x2, y2 };
    t.x1 = x1;
    t.y1 = y1;
    t.x2 = x2;
    t.y2 = y2;
    rt.tiles[i] = t;
    rt.gfx.tile({ op: "tile", sub: "rect", i, x1, y1, x2, y2 });
    return 0;
  };
}

function makeTileDraw(rt: MythroadRuntime): NativeFunction {
  return (L) => {
    const i = L.optNumber(1, 0) | 0;
    if (i >= TILEMAX) throw new LuaRuntimeError("TileDraw:tile index out of rang!");
    const t = rt.tiles[i] ?? { x: 0, y: 0, w: 0, h: 0, tileh: 0, x1: 0, y1: 0, x2: 0, y2: 0 };
    rt.gfx.tile({ op: "tile", sub: "draw", i, x: t.x, y: t.y, w: t.w, h: t.h, tileh: t.tileh });
    return 0;
  };
}
