import { ExtFault } from "../abi/fault.ts";
import { ExtRuntime } from "../abi/runtime.ts";
import { LuaRuntimeError } from "../err/errors.ts";
import { TAG_STRING } from "../lua/types.ts";
import { LuaVM } from "../lua/vm.ts";
import { MRPArchive } from "../mrp/archive.ts";
import {
  MR_IGNORE,
  MR_START_FILE,
  MR_STATE_IDLE,
  MR_STATE_PAUSE,
  MR_STATE_RUN,
  MR_STATE_STOP,
  MR_SUCCESS,
  MR_TIMER_STATE_IDLE,
} from "./constants.ts";
import { EV_CUSTOM, EV_KEY, EV_SYSTEM, EV_TIMER, EventQueue, type RuntimeEvent } from "./events.ts";
import { NullGraphicsBackend, type GraphicsBackend } from "./graphics.ts";
import { InputBackend } from "./input.ts";
import { installNatives } from "./native.ts";
import { defaultProfile, type DeviceProfile } from "./profile.ts";
import { createStrCom } from "./strcom.ts";
import { MythroadTimer } from "./timer.ts";
import { MythroadVfs } from "./vfs.ts";

export type MythroadRuntimeOptions = {
  profile?: Partial<DeviceProfile>;
  graphics?: GraphicsBackend;
  entry?: string;
  param?: string;
};

/**
 * Lua VM → native ABI → Mythroad → (VFS / timer / events / gfx) → mr_table → EXT → CPU.
 * State lives here, not inside LuaVM.
 */
export class MythroadRuntime {
  readonly lua = new LuaVM();
  readonly vfs = new MythroadVfs();
  readonly timers = new MythroadTimer();
  readonly events = new EventQueue();
  readonly gfx: GraphicsBackend;
  readonly input: InputBackend;
  readonly profile: DeviceProfile;
  readonly strCom: ReturnType<typeof createStrCom>;

  archive: MRPArchive | null = null;
  ext: ExtRuntime | null = null;

  state = MR_STATE_IDLE;
  clock = 0;
  packName = "";
  entry = "_dsm";
  param = "";
  bi = 0;
  screenW: number;
  screenH: number;
  randSeed: number;
  gcCalls = 0;
  gcThreshold = 0;
  sleeps: number[] = [];
  exited = false;
  lastDispatch = 0;
  steps = 0;

  constructor(opts: MythroadRuntimeOptions = {}) {
    this.profile = defaultProfile(opts.profile);
    this.gfx = opts.graphics ?? new NullGraphicsBackend();
    this.input = new InputBackend(this.events);
    this.screenW = this.profile.width;
    this.screenH = this.profile.height;
    this.randSeed = this.profile.randSeed;
    this.entry = opts.entry ?? "_dsm";
    this.param = opts.param ?? "";
    this.strCom = createStrCom({
      getVfs: () => this.vfs,
      getExt: () => this.ext,
      setExt: (rt) => {
        this.ext = rt;
      },
    });
    installNatives(this);
    this.lua.L.setGlobal("_mr_entry", TAG_STRING, this.lua.L.internStr(this.entry));
    this.lua.L.setGlobal("_mr_param", TAG_STRING, this.lua.L.internStr(this.param));
  }

  get mrp(): MRPArchive | null {
    return this.archive;
  }

  loadMrp(bytes: Uint8Array): MRPArchive {
    this.archive = MRPArchive.parse(bytes);
    this.vfs.attach(this.archive);
    this.packName = this.archive.header.filename || "app.mrp";
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

  pause(): number {
    if (this.state === MR_STATE_RUN) this.state = MR_STATE_PAUSE;
    else return MR_IGNORE;
    if (this.lua.hasGlobalFn("suspend")) this.lua.callGlobal("suspend");
    if (!this.timers.runWithoutPause) this.timers.suspend();
    return MR_SUCCESS;
  }

  resume(): number {
    if (this.state === MR_STATE_PAUSE) this.state = MR_STATE_RUN;
    else return MR_IGNORE;
    if (this.lua.hasGlobalFn("resume")) this.lua.callGlobal("resume");
    this.timers.resume(this.clock);
    return MR_SUCCESS;
  }

  private dispatchTimer(): number {
    if (!this.canRun()) return MR_IGNORE;
    if (this.ext) {
      const out = this.ext.arm_ext_call(2, new Uint8Array(0));
      if (out.kind !== "return") throw new ExtFault(out.kind, 0, "timer EXT");
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
      if (out.kind !== "return") throw new ExtFault(out.kind, 0, "event EXT");
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
