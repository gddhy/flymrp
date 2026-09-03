import { LuaRuntimeError, NativeAbiError, VfsError } from "../err/errors.ts";
import { LuaState } from "../lua/state.ts";
import { TAG_NUMBER, TAG_TABLE, type NativeFunction } from "../lua/types.ts";
import {
  BITMAPMAX,
  MR_FAILED,
  MR_FILE_RDONLY,
  MR_FILE_STATE_CLOSED,
  MR_FILE_STATE_NIL,
  MR_FILE_STATE_OPEN,
  MR_FLAGS_BI,
  MR_FONT_MEDIUM,
  MR_SEEK_SET,
  MR_VERSION,
  SHORT_TYPENAMES,
} from "./constants.ts";
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
        throw new NativeAbiError(`_com code ${a0} not implemented in Stage 5-B`);
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
    rt.gfx.drawText(text, x, y, r, g, b, uni, font);
    return 0;
  };
}

function makeDrawRect(rt: MythroadRuntime): NativeFunction {
  return (L) => {
    rt.gfx.drawRect(
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

function makeClear(rt: MythroadRuntime): NativeFunction {
  return (L) => {
    rt.gfx.clear(L.optNumber(1, 0) | 0, L.optNumber(2, 0) | 0, L.optNumber(3, 0) | 0);
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
