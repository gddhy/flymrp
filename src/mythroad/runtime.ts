import type { EditState } from "./native-editor.ts";
import type { NetworkRules } from "./network-rules.ts";
import { ExtFault, type ExtCallResult } from "../abi/fault.ts";
import { DEFAULT_INSN_BUDGET, ExtRuntime, MAX_INSN_BUDGET } from "../abi/runtime.ts";
import { LuaRuntimeError, UnknownAbiError } from "../err/errors.ts";
import { TAG_STRING } from "../lua/types.ts";
import { LuaVM } from "../lua/vm.ts";
import { MRPArchive } from "../mrp/archive.ts";
import {
  MR_IGNORE,
  MR_START_FILE,
  MR_STATE_IDLE,
  MR_STATE_PAUSE,
  MR_STATE_RESTART,
  MR_STATE_RUN,
  MR_STATE_STOP,
  MR_SUCCESS,
  MR_TIMER_STATE_IDLE,
  type RuntimeAction,
} from "./constants.ts";
import { EV_CUSTOM, EV_KEY, EV_SYSTEM, EV_TIMER, EventQueue, type RuntimeEvent } from "./events.ts";
import { NullGraphicsBackend, ScreenBuffer, type BitmapSlot, type GraphicsBackend, type SpriteSlot, type TileSlot } from "./graphics.ts";
import { InputBackend } from "./input.ts";
import { installNatives } from "./native.ts";
import {
  RuntimeTrace,
  attachTrace,
  raiseUnknown,
  stackPreview,
  wrapExtInstance,
  wrapGraphics,
  wrapNatives,
  wrapLua as rewrapLua,
  type AbiMode,
  type ApprovedBehavior,
  type UnknownAbiEvent,
} from "./probe.ts";
import { defaultProfile, type DeviceProfile } from "./profile.ts";
import { MrTableBridge, type AllocRecord, type ReadFileRecord } from "./mr-table.ts";
import { createStrCom } from "./strcom.ts";
import { MythroadTimer } from "./timer.ts";
import { MythroadVfs } from "./vfs.ts";

export type MythroadRuntimeOptions = {
  profile?: Partial<DeviceProfile>;
  networkRules?: NetworkRules;
  onEditChange?: (state: EditState | null) => void;
  /** Bundled handset files, copied into each runtime’s virtual filesystem. */
  systemFiles?: Readonly<Record<string, Uint8Array>>;
  graphics?: GraphicsBackend;
  entry?: string;
  param?: string;
  /** Optional. Default off. Does not change ABI when omitted. */
  trace?: RuntimeTrace | boolean;
  /** Default `strict`: unknown ABI stops. */
  abiMode?: AbiMode;
  /** Permissive-only. Keys like `_com:700`. Not an ABI guess. */
  approvedUnknown?: Record<string, ApprovedBehavior>;
  /**
   * ARM/Thumb instruction watchdog for `arm_ext_call` / `runGuest`.
   * Not an execution slice. Omitted → `DEFAULT_INSN_BUDGET`. Clamped to `MAX_INSN_BUDGET`.
   */
  armInstructionBudget?: number;
  /** Observes each `arm_ext_call`. Does not change ABI. */
  onExtCall?: (code: number, out: ExtCallResult) => void;
  /** Host audio sink. Node tests omit this; the web player supplies Web Audio. */
  onPlaySound?: (type: number, data: Uint8Array | null, loop: number) => void;
  onStopSound?: (type: number) => void;
};

/**
 * Lua VM → native ABI → Mythroad → (VFS / timer / events / gfx) → mr_table → EXT → CPU.
 * State lives here, not inside LuaVM.
 */
export class MythroadRuntime {
  lua = new LuaVM();
  readonly vfs = new MythroadVfs();
  private readonly networkRules?: NetworkRules;
  private readonly onEditChange?: (state: EditState | null) => void;
  private readonly systemFiles: Readonly<Record<string, Uint8Array>>;
  readonly timers = new MythroadTimer();
  readonly events = new EventQueue();
  readonly gfx: GraphicsBackend;
  readonly input: InputBackend;
  readonly profile: DeviceProfile;
  readonly strCom: ReturnType<typeof createStrCom>;

  archive: MRPArchive | null = null;
  ext: ExtRuntime | null = null;
  mrTable: MrTableBridge | null = null;
  readonly mrAllocs: AllocRecord[] = [];
  readonly mrReads: ReadFileRecord[] = [];
  unknownRequiredSlot: number | null = null;

  state = MR_STATE_IDLE;
  /** Elapsed monotonic milliseconds since runtime start. `mr_getTime` exposes `clock >>> 0`. */
  clock = 0;
  packName = "";
  entry = "_dsm";
  param = "";
  bi = 0;
  screenW: number;
  screenH: number;
  screen: ScreenBuffer;
  randSeed: number;
  gcCalls = 0;
  gcThreshold = 0;
  sleeps: number[] = [];
  readonly logs: string[] = [];
  exited = false;
  lastDispatch = 0;
  steps = 0;
  pendingPack = "";
  pendingStartFile = "";
  pendingParam = "";
  lastAction: RuntimeAction | null = null;
  readonly bitmaps: BitmapSlot[] = [];
  readonly sprites: SpriteSlot[] = [];
  readonly tiles: TileSlot[] = [];
  readonly trace: RuntimeTrace | null = null;
  readonly abiMode: AbiMode = "strict";
  readonly armInstructionBudget: number;
  readonly approvedUnknown = new Map<string, ApprovedBehavior>();
  readonly unknownEvents: UnknownAbiEvent[] = [];
  onExtCall: ((code: number, out: ExtCallResult) => void) | null = null;
  private readonly onPlaySound: ((type: number, data: Uint8Array | null, loop: number) => void) | null;
  private readonly onStopSound: ((type: number) => void) | null;

  constructor(opts: MythroadRuntimeOptions = {}) {
    this.profile = defaultProfile(opts.profile);
    this.abiMode = opts.abiMode ?? "strict";
    this.armInstructionBudget = Math.min(
      Math.max(opts.armInstructionBudget ?? DEFAULT_INSN_BUDGET, 1),
      MAX_INSN_BUDGET,
    );
    if (opts.approvedUnknown) {
      for (const [k, v] of Object.entries(opts.approvedUnknown)) this.approvedUnknown.set(k, v);
    }
    this.trace =
      opts.trace instanceof RuntimeTrace
        ? opts.trace
        : opts.trace === true || opts.abiMode === "trace"
          ? new RuntimeTrace()
          : null;
    const rawGfx = opts.graphics ?? new NullGraphicsBackend();
    this.gfx = this.trace ? wrapGraphics(rawGfx, this.trace) : rawGfx;
    this.input = new InputBackend(this.events);
    this.screenW = this.profile.width;
    this.screenH = this.profile.height;
    this.screen = new ScreenBuffer(this.screenW, this.screenH);
    this.randSeed = this.profile.randSeed;
    this.systemFiles = opts.systemFiles ?? {};
    this.networkRules = opts.networkRules;
    this.onEditChange = opts.onEditChange;
    this.entry = opts.entry ?? "_dsm";
    this.param = opts.param ?? "";
    this.onExtCall = opts.onExtCall ?? null;
    this.onPlaySound = opts.onPlaySound ?? null;
    this.onStopSound = opts.onStopSound ?? null;
    this.strCom = createStrCom({
      getVfs: () => this.vfs,
      getExt: () => this.ext,
      setExt: (rt) => {
        this.bindExt(rt);
      },
      onUnknown: (code, L) => {
        const preview = stackPreview(L);
        return raiseUnknown(this, {
          caller: "lua",
          family: "_strCom",
          code,
          arguments: preview.arguments,
          argumentTypes: preview.argumentTypes,
          returnContext: "native",
          message: `_strCom code ${code} not implemented in Stage 5-C`,
        });
      },
    });
    installNatives(this);
    this.lua.L.setGlobal("_mr_entry", TAG_STRING, this.lua.L.internStr(this.entry));
    this.lua.L.setGlobal("_mr_param", TAG_STRING, this.lua.L.internStr(this.param));
    if (this.trace) attachTrace(this, this.trace);
  }

  get mrp(): MRPArchive | null {
    return this.archive;
  }

  unknownAbi(family: string, code: number, L: import("../lua/state.ts").LuaState): number {
    const preview = stackPreview(L);
    return raiseUnknown(this, {
      caller: "lua",
      family,
      code,
      arguments: preview.arguments,
      argumentTypes: preview.argumentTypes,
      returnContext: "native",
      message: `${family} code ${code} not implemented in Stage 5-C`,
    });
  }

  loadMrp(bytes: Uint8Array): MRPArchive {
    this.archive = MRPArchive.parse(bytes);
    this.vfs.attach(this.archive);
    this.packName = this.archive.header.filename || "app.mrp";
    this.ext?.setPackTableName(this.packName);
    // Old current-pack handles must not silently alias a newly loaded archive.
    this.mrTable?.files.reset();
    return this.archive;
  }

  start(entry = MR_START_FILE): void {
    if (!this.archive) throw new LuaRuntimeError("no MRP loaded");
    this.state = MR_STATE_RUN;
    this.exited = false;
    this.lua.L.setGlobal("_mr_entry", TAG_STRING, this.lua.L.internStr(this.entry));
    this.lua.L.setGlobal("_mr_param", TAG_STRING, this.lua.L.internStr(this.param));
    const chunk = this.vfs.readFile(entry);
    if (!chunk) throw new LuaRuntimeError(`cannot read ${entry}`);
    this.lua.runBytes(chunk);
    if (this.timers.state === MR_TIMER_STATE_IDLE && this.lua.hasGlobalFn("dealtimer")) {
      this.timers.start(this.clock, 100, "dealtimer", this.state);
    }
  }

  canRun(): boolean {
    return this.state === MR_STATE_RUN || (this.timers.runWithoutPause !== 0 && this.state === MR_STATE_PAUSE);
  }

  advance(ms: number): void {
    if (ms < 0) throw new LuaRuntimeError(`advance(${ms})`);
    this.clock += ms | 0;
    const cb = this.timers.due(this.clock);
    if (cb) this.events.queue(EV_TIMER, 0, 0, 0);
  }

  queueEvent(kind: number, type: number, p1 = 0, p2 = 0): void {
    this.events.queue(kind, type, p1, p2);
  }

  pollEvent(): RuntimeEvent | null {
    return this.events.poll();
  }

  dispatchEvent(ev: RuntimeEvent): number {
    this.lastDispatch = ev.kind;
    if (ev.kind === EV_TIMER) return this.dispatchTimer();
    if (ev.kind === EV_KEY && (ev.type === 0 || ev.type === 1) && this.mrTable?.editor.key(ev.type, ev.p1)) return MR_SUCCESS;
    return this.dispatchMrEvent(ev.type, ev.p1, ev.p2);
  }

  /** One queued event → Lua/native/EXT. Never an infinite while. */
  step(): boolean {
    const ev = this.events.poll();
    if (!ev) return false;
    this.steps++;
    this.dispatchEvent(ev);
    return true;
  }

  requestRunFile(pack: string, file: string, param: string): void {
    this.pendingPack = pack;
    this.pendingStartFile = file;
    this.pendingParam = param ?? "";
    this.lastAction = { kind: "RUN_FILE", pack, file, param: this.pendingParam };
    this.timers.start(this.clock, 100, "restart", MR_STATE_RUN);
    this.state = MR_STATE_RESTART;
  }

  applyRestart(): void {
    this.lastAction = { kind: "RESTART" };
    this.timers.stop();
    this.exited = false;
    this.ext = null;
    this.mrTable = null;
    this.events.clear();
    this.rebindLua();
    this.packName = this.pendingPack || this.packName;
    this.param = this.pendingParam;
    this.lua.L.setGlobal("_mr_entry", TAG_STRING, this.lua.L.internStr(this.entry));
    this.lua.L.setGlobal("_mr_param", TAG_STRING, this.lua.L.internStr(this.param));
    this.state = MR_STATE_RUN;
    const name = this.pendingStartFile || MR_START_FILE;
    const chunk = this.vfs.readFile(name);
    if (!chunk) throw new LuaRuntimeError(`cannot read ${name}`);
    this.lua.runBytes(chunk);
    if (this.timers.state === MR_TIMER_STATE_IDLE && this.lua.hasGlobalFn("dealtimer")) {
      this.timers.start(this.clock, 100, "dealtimer", this.state);
    }
  }

  rebindLua(): void {
    this.lua = new LuaVM();
    installNatives(this);
    if (this.trace) {
      wrapNatives(this, this.trace);
      rewrapLua(this, this.trace);
    }
  }

  pause(): number {
    if (this.state === MR_STATE_RESTART) {
      this.timers.stop();
      return MR_SUCCESS;
    }
    if (this.state === MR_STATE_RUN) this.state = MR_STATE_PAUSE;
    else return MR_IGNORE;
    if (this.lua.hasGlobalFn("suspend")) this.lua.callGlobal("suspend");
    if (!this.timers.runWithoutPause) this.timers.suspend();
    return MR_SUCCESS;
  }

  resume(): number {
    if (this.state === MR_STATE_RESTART) {
      this.timers.start(this.clock, 100, "restart", MR_STATE_RUN);
      return MR_SUCCESS;
    }
    if (this.state === MR_STATE_PAUSE) this.state = MR_STATE_RUN;
    else return MR_IGNORE;
    if (this.lua.hasGlobalFn("resume")) this.lua.callGlobal("resume");
    this.timers.resume(this.clock);
    return MR_SUCCESS;
  }

  bindExt(rt: ExtRuntime | null): void {
    if (!rt) {
      this.ext = null;
      this.mrTable = null;
      return;
    }
    const owner = this.packName || "ext";
    const exitGuest = () => {
      this.state = MR_STATE_STOP;
      this.exited = true;
      this.timers.stop();
      this.events.clear();
      throw new LuaRuntimeError("Exiting...");
    };
    rt.onGuestExit = exitGuest;
    const bridge = new MrTableBridge(rt, this.vfs, owner, {
      networkRules: this.networkRules,
      onEditChange: this.onEditChange,
      onEditComplete: accepted => this.queueEvent(EV_SYSTEM, 6, accepted ? 0 : 1, 0),
      getDownloadFile: name => this.systemFiles[name] ?? null,
      getClock: () => this.clock,
      onSleep: (ms) => { this.clock += ms; },
      onExit: exitGuest,
      getTimer: () => this.timers,
      getMrState: () => this.state,
      getPack: () => (this.archive ? { name: this.packName, bytes: this.archive.data } : null),
      getProfile: () => this.profile,
      getScreen: () => this.screen,
      onDrawRect: (x, y, w, h, r, g, b) => this.gfx.drawRect(x, y, w, h, r, g, b),
      onDrawText: (text, x, y, r, g, b, unicode, font) => this.gfx.drawText(text, x, y, r, g, b, unicode, font),
      onFlush: (x, y, w, h) => this.gfx.flush(x, y, w, h, 0),
      onPlaySound: (type, data, loop) => this.onPlaySound?.(type, data, loop),
      onStopSound: (type) => this.onStopSound?.(type),
      onAlloc: (rec) => this.mrAllocs.push(rec),
      onRead: (rec) => this.mrReads.push(rec),
      onUnknownAbi: (info) => {
        const ev = {
          caller: "ext",
          family: info.family,
          code: info.code,
          arguments: [info.code],
          argumentTypes: ["number"],
          returnContext: "ext",
          message: info.message,
        };
        this.unknownEvents.push(ev);
        this.trace?.noteUnknown(ev);
      },
      onUnknownSlot: (n) => {
        this.unknownRequiredSlot = n;
        const message = `UNKNOWN_REQUIRED_SLOT = ${n}`;
        const ev = {
          caller: "ext",
          family: "mr_table",
          code: n,
          arguments: [n],
          argumentTypes: ["number"],
          returnContext: "ext",
          message,
        };
        this.unknownEvents.push(ev);
        this.trace?.noteUnknown(ev);
        throw new UnknownAbiError(message, { family: "mr_table", code: n, caller: "ext" });
      },
    });
    for (const [name, bytes] of Object.entries(this.systemFiles)) bridge.appFs.replace(name, bytes.slice());
    bridge.install();
    rt.setPackTableName(this.packName);
    rt.insnBudget = this.armInstructionBudget;
    rt.onExtCall = this.onExtCall;
    this.mrTable = bridge;
    this.ext = this.trace ? wrapExtInstance(rt, this.trace) : rt;
  }

  private dispatchTimer(): number {
    if (this.state === MR_STATE_RESTART) {
      this.applyRestart();
      return MR_SUCCESS;
    }
    if (!this.canRun()) return MR_IGNORE;
    if (this.ext) {
      const out = this.ext.arm_ext_call(2, new Uint8Array(0));
      if (out.kind !== "return") throw new ExtFault(out.kind, out.pc ?? 0, `timer EXT${out.detail ? `: ${out.detail}` : ""}`);
    }
    const name = this.timers.callback;
    if (!this.lua.callGlobal(name)) {
      /* official prints warning; not a swallowed fault */
    }
    return MR_SUCCESS;
  }

  private dispatchMrEvent(type: number, p1: number, p2: number): number {
    if (!this.canRun()) return MR_IGNORE;
    if (this.lua.hasGlobalFn("dealevent")) {
      this.lua.callGlobal("dealevent", [type, p1, p2]);
      return MR_SUCCESS;
    }
    if (this.ext) {
      const out = this.ext.arm_ext_call(1, packEvent(type, p1, p2));
      if (out.kind !== "return") throw new ExtFault(out.kind, out.pc ?? 0, `event EXT${out.detail ? `: ${out.detail}` : ""}`);
      return MR_SUCCESS;
    }
    return MR_IGNORE;
  }
}

function packEvent(type: number, p1: number, p2: number): Uint8Array {
  const b = new Uint8Array(12);
  const v = new DataView(b.buffer);
  v.setInt32(0, type, true);
  v.setInt32(4, p1, true);
  v.setInt32(8, p2, true);
  return b;
}

export { EV_CUSTOM, EV_KEY, EV_SYSTEM, EV_TIMER };
