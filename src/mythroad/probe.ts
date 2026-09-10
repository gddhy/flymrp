import { UnknownAbiError } from "../err/errors.ts";
import { LuaState } from "../lua/state.ts";
import { TAG_BOOL, TAG_FUNCTION, TAG_NIL, TAG_NUMBER, TAG_STRING, TAG_TABLE, type NativeFunction } from "../lua/types.ts";
import type { ExtRuntime } from "../abi/runtime.ts";
import { EV_TIMER } from "./events.ts";
import type { GraphicsBackend } from "./graphics.ts";
import type { MythroadRuntime } from "./runtime.ts";
import type { LuaTable } from "../lua/table.ts";

export type AbiMode = "strict" | "trace" | "permissive";
export type ApprovedBehavior = "return0" | "returnNil";
export type RuntimePhase = "idle" | "load" | "start" | "run" | "event" | "timer" | "restart" | "exit";

export type TraceRecord = {
  sequence: number;
  phase: RuntimePhase;
  operation: string;
  arguments: unknown;
  returnValue: unknown;
};

export type UnknownAbiEvent = {
  caller: string;
  family: string;
  code: string | number;
  arguments: unknown[];
  argumentTypes: string[];
  returnContext: string;
  message: string;
};

const TAG_NAMES = ["nil", "bool", "light", "number", "string", "table", "function", "userdata", "thread"];
const MAX_TRACE = 8192;
const wrappedFns = new WeakSet<NativeFunction>();

export class RuntimeTrace {
  enabled = true;
  records: TraceRecord[] = [];
  unknown: UnknownAbiEvent[] = [];
  seq = 0;
  phase: RuntimePhase = "idle";

  record(operation: string, args: unknown = null, returnValue: unknown = null): void {
    if (!this.enabled) return;
    if (this.records.length >= MAX_TRACE) return;
    this.records.push({
      sequence: ++this.seq,
      phase: this.phase,
      operation,
      arguments: summarizeValue(args),
      returnValue: summarizeValue(returnValue),
    });
  }

  noteUnknown(ev: UnknownAbiEvent): void {
    this.unknown.push(ev);
    this.record("UNKNOWN_ABI", ev, "stop");
  }
}

export function summarizeSlot(L: LuaState, i: number): unknown {
  const t = L.tags[i]!;
  const n = L.nums[i]!;
  if (t === TAG_NIL) return null;
  if (t === TAG_BOOL) return n !== 0;
  if (t === TAG_NUMBER) return n | 0;
  if (t === TAG_STRING) {
    const s = L.strings[n] ?? "";
    return s.length > 24 ? `${s.slice(0, 24)}…(${s.length})` : s;
  }
  if (t === TAG_TABLE) return `{table#${n}}`;
  if (t === TAG_FUNCTION) return `{fn#${n}}`;
  return `{${TAG_NAMES[t] ?? t}:${n}}`;
}

export function stackPreview(L: LuaState, max = 6): { arguments: unknown[]; argumentTypes: string[] } {
  const n = L.gettop();
  const args: unknown[] = [];
  const types: string[] = [];
  for (let i = 1; i <= n && i <= max; i++) {
    const idx = L.absindex(i);
    types.push(TAG_NAMES[L.tags[idx]!] ?? `tag${L.tags[idx]}`);
    args.push(summarizeSlot(L, idx));
  }
  return { arguments: args, argumentTypes: types };
}

function summarizeValue(v: unknown): unknown {
  if (v instanceof Uint8Array) return `{bytes:${v.length}}`;
  if (typeof v === "string" && v.length > 48) return `${v.slice(0, 48)}…(${v.length})`;
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    if ("s" in o && typeof o.s === "string" && o.s.length > 24) {
      return { ...o, s: `${o.s.slice(0, 24)}…(${o.s.length})` };
    }
  }
  return v;
}

export function attachTrace(rt: MythroadRuntime, tr: RuntimeTrace): void {
  wrapLua(rt, tr);
  wrapVfs(rt, tr);
  wrapTimer(rt, tr);
  wrapNatives(rt, tr);
  wrapLifecycle(rt, tr);
}

export function wrapNatives(rt: MythroadRuntime, tr: RuntimeTrace): void {
  wrapClosureTable(rt, tr, rt.lua.L.globals);
  for (const name of ["file", "sys", "string", "table"]) {
    const g = rt.lua.L.getGlobal(name);
    if (g.tag === TAG_TABLE) wrapClosureTable(rt, tr, rt.lua.L.tables[g.num]!);
  }
}

function wrapClosureTable(rt: MythroadRuntime, tr: RuntimeTrace, tab: LuaTable): void {
  const visit = (slot: { tag: number; num: number }) => {
    if (slot.tag !== TAG_FUNCTION) return;
    const cl = rt.lua.L.closures[slot.num];
    if (!cl || !cl.isC || wrappedFns.has(cl.fn)) return;
    const orig = cl.fn;
    const wrapped: NativeFunction = (L) => {
      const preview = stackPreview(L);
      tr.record("native", { args: preview.arguments, types: preview.argumentTypes }, null);
      const n = orig(L);
      tr.record("native_return", null, n);
      return n;
    };
    wrappedFns.add(orig);
    wrappedFns.add(wrapped);
    cl.fn = wrapped;
  };
  for (const s of tab.arr) visit(s);
  for (const s of tab.map.values()) visit(s);
}

export function wrapLua(rt: MythroadRuntime, tr: RuntimeTrace): void {
  const lua = rt.lua;
  const callGlobal = lua.callGlobal.bind(lua);
  lua.callGlobal = (name, args = [], nresults = 0) => {
    tr.record("lua_global", { name, args: args.slice(0, 4) }, null);
    const ok = callGlobal(name, args, nresults);
    tr.record("lua_global_return", { name }, ok);
    return ok;
  };
  const runBytes = lua.runBytes.bind(lua);
  lua.runBytes = (bytes, nresults) => {
    tr.record("lua_chunk", { bytes: bytes.length }, null);
    runBytes(bytes, nresults);
    tr.record("lua_chunk_return", null, "ok");
  };
}

function wrapVfs(rt: MythroadRuntime, tr: RuntimeTrace): void {
  const vfs = rt.vfs;
  const readFile = vfs.readFile.bind(vfs);
  vfs.readFile = (name) => {
    const data = readFile(name);
    tr.record("vfs_read", { name }, data ? data.length : null);
    return data;
  };
  const exists = vfs.exists.bind(vfs);
  vfs.exists = (name) => {
    const ok = exists(name);
    tr.record("vfs_exists", { name }, ok);
    return ok;
  };
  const open = vfs.open.bind(vfs);
  vfs.open = (name, mode) => {
    const fd = open(name, mode);
    tr.record("vfs_open", { name, mode }, fd);
    return fd;
  };
}

function wrapTimer(rt: MythroadRuntime, tr: RuntimeTrace): void {
  const t = rt.timers;
  const start = t.start.bind(t);
  t.start = (now, interval, callback, mrState) => {
    const ok = start(now, interval, callback, mrState);
    tr.record("timer_start", { interval, callback, mrState }, ok);
    return ok;
  };
  const stop = t.stop.bind(t);
  t.stop = () => {
    stop();
    tr.record("timer_stop", null, "ok");
  };
}

export function wrapGraphics(gfx: GraphicsBackend, tr: RuntimeTrace): GraphicsBackend {
  const rec = (op: string, args: unknown) => tr.record("graphics", { op, ...asObj(args) }, null);
  return {
    clear: (r, g, b) => {
      rec("clear", { r, g, b });
      gfx.clear(r, g, b);
    },
    drawRect: (x, y, w, h, r, g, b) => {
      rec("rect", { x, y, w, h });
      gfx.drawRect(x, y, w, h, r, g, b);
    },
    drawLine: (x1, y1, x2, y2, r, g, b) => {
      rec("line", { x1, y1, x2, y2 });
      gfx.drawLine(x1, y1, x2, y2, r, g, b);
    },
    drawPoint: (x, y, r, g, b) => {
      rec("point", { x, y });
      gfx.drawPoint(x, y, r, g, b);
    },
    drawText: (text, x, y, r, g, b, unicode, font) => {
      rec("text", { text: text.length > 24 ? `${text.slice(0, 24)}…` : text, x, y });
      gfx.drawText(text, x, y, r, g, b, unicode, font);
    },
    effSetCon: (x, y, w, h, perr, perg, perb) => {
      rec("eff", { x, y, w, h });
      gfx.effSetCon(x, y, w, h, perr, perg, perb);
    },
    flush: (x, y, w, h, index) => {
      rec("flush", { x, y, w, h, index });
      gfx.flush(x, y, w, h, index);
    },
    image: (cmd) => {
      rec("image", cmd);
      gfx.image(cmd);
    },
    sprite: (cmd) => {
      rec("sprite", cmd);
      gfx.sprite(cmd);
    },
    tile: (cmd) => {
      rec("tile", cmd);
      gfx.tile(cmd);
    },
  };
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : { value: v };
}

function wrapLifecycle(rt: MythroadRuntime, tr: RuntimeTrace): void {
  const start = rt.start.bind(rt);
  rt.start = (entry) => {
    tr.phase = "start";
    tr.record("start", { entry: entry ?? "start.mr" }, null);
    start(entry);
    tr.phase = "run";
  };
  const loadMrp = rt.loadMrp.bind(rt);
  rt.loadMrp = (bytes) => {
    tr.phase = "load";
    tr.record("load_mrp", { bytes: bytes.length }, null);
    const arc = loadMrp(bytes);
    tr.record("load_mrp_ok", { files: arc.listFiles().slice(0, 32) }, arc.entries.length);
    return arc;
  };
  const dispatch = rt.dispatchEvent.bind(rt);
  rt.dispatchEvent = (ev) => {
    tr.phase = ev.kind === EV_TIMER ? "timer" : "event";
    tr.record("event", { kind: ev.kind, type: ev.type, p1: ev.p1, p2: ev.p2 }, null);
    const ret = dispatch(ev);
    tr.record("event_return", { kind: ev.kind }, ret);
    tr.phase = "run";
    return ret;
  };
  const req = rt.requestRunFile.bind(rt);
  rt.requestRunFile = (pack, file, param) => {
    tr.record("run_file", { pack, file, param }, null);
    req(pack, file, param);
  };
  const restart = rt.applyRestart.bind(rt);
  rt.applyRestart = () => {
    tr.phase = "restart";
    tr.record("restart", { file: rt.pendingStartFile }, null);
    restart();
    tr.phase = "run";
  };
}

export function wrapExtInstance(ext: ExtRuntime, tr: RuntimeTrace): ExtRuntime {
  const load = ext.load.bind(ext);
  ext.load = (bytes, opts) => {
    tr.record("ext_load", { bytes: bytes.length, loadCode: opts?.loadCode ?? 0 }, null);
    const out = load(bytes, opts);
    tr.record("ext_load_return", { kind: out.kind, ret: out.ret }, out.kind);
    return out;
  };
  const call = ext.arm_ext_call.bind(ext);
  ext.arm_ext_call = (code, input, inputAddr, inputLen) => {
    tr.record("ext_call", { slot: code, inLen: input?.length ?? inputLen ?? 0 }, null);
    const out = call(code, input, inputAddr, inputLen);
    tr.record("ext_return", { slot: code, kind: out.kind, r0: out.r0 }, out.kind);
    return out;
  };
  return ext;
}

export function raiseUnknown(
  rt: MythroadRuntime,
  ev: Omit<UnknownAbiEvent, "message"> & { message?: string },
): number {
  const message = ev.message ?? `${ev.family} ${ev.code} UNKNOWN ABI`;
  const full: UnknownAbiEvent = { ...ev, message, returnContext: ev.returnContext };
  rt.unknownEvents.push(full);
  rt.trace?.noteUnknown(full);
  const key = `${ev.family}:${ev.code}`;
  const allow = rt.abiMode === "permissive" ? rt.approvedUnknown.get(key) : undefined;
  if (allow === "return0") {
    rt.lua.L.pushInteger(0);
    return 1;
  }
  if (allow === "returnNil") {
    rt.lua.L.pushNil();
    return 1;
  }
  throw new UnknownAbiError(message, { family: ev.family, code: ev.code, caller: ev.caller });
}
