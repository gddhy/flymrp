import { ExtFault, ExtStopped } from "../abi/fault.ts";
import { ExtRuntime } from "../abi/runtime.ts";
import { NativeAbiError } from "../err/errors.ts";
import { LuaState } from "../lua/state.ts";
import { NativeFunction } from "../lua/types.ts";
import { UnsupportedInsn, CpuTrap } from "../hot/cpu.ts";
import { MemoryFault } from "../hot/memory.ts";
import { MR_SUCCESS } from "./constants.ts";
import type { MythroadVfs } from "./vfs.ts";

/**
 * `_strCom(code, str [, extra])` — rxgj `TestCom1` / `_mr_TestCom1`.
 *
 * Confirmed ABI (mythroad.c):
 *   601: read file; push string or nil; return 1
 *   602: exists; push nil or MR_SUCCESS; return 1
 *   800: arm_ext_load(str, len, optint(3)=code); push ext_r0 or status; return 1
 *   801: arm_ext_call(tonumber(3), str, len); push output, ret; return 2
 *   802: same load path as 800
 */
export function createStrCom(ctx: {
  getVfs: () => MythroadVfs;
  getExt: () => ExtRuntime | null;
  setExt: (rt: ExtRuntime | null) => void;
}): NativeFunction {
  return (L: LuaState) => {
    const code = L.optNumber(1, 0) | 0;
    const arg2 = L.checkString(2);
    const extra = L.optNumber(3, 0) | 0;
    switch (code) {
      case 601: {
        const data = ctx.getVfs().readFile(arg2.s);
        if (!data) {
          L.pushNil();
          return 1;
        }
        L.pushString(data);
        return 1;
      }
      case 602: {
        if (!ctx.getVfs().exists(arg2.s)) L.pushNil();
        else L.pushInteger(MR_SUCCESS);
        return 1;
      }
      case 800:
      case 802: {
        const bytes = strBytes(arg2.s);
        const rt = new ExtRuntime();
        try {
          const loaded = rt.load(bytes, { loadCode: extra });
          if (loaded.kind !== "return") {
            throw new ExtFault(loaded.kind, 0, `_strCom(${code}) load kind=${loaded.kind}`);
          }
          ctx.setExt(rt);
          L.pushInteger(loaded.ret | 0);
          return 1;
        } catch (e) {
          ctx.setExt(null);
          rethrowExt(e);
        }
      }
      case 801: {
        const rt = ctx.getExt();
        if (!rt) throw new NativeAbiError("_strCom(801) without a loaded EXT");
        const input = strBytes(arg2.s);
        try {
          const out = rt.arm_ext_call(extra, input);
          if (out.kind !== "return") {
            throw new ExtFault(out.kind, 0, `arm_ext_call kind=${out.kind}`);
          }
          L.pushString(out.output);
          L.pushInteger(out.r0 | 0);
          return 2;
        } catch (e) {
          rethrowExt(e);
        }
      }
      default:
        throw new NativeAbiError(`_strCom code ${code} not implemented in Stage 5-B`);
    }
  };
}

function strBytes(s: string): Uint8Array {
  const o = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i) & 0xff;
  return o;
}

function rethrowExt(e: unknown): never {
  if (
    e instanceof ExtFault ||
    e instanceof ExtStopped ||
    e instanceof UnsupportedInsn ||
    e instanceof CpuTrap ||
    e instanceof MemoryFault ||
    e instanceof NativeAbiError
  ) {
    throw e;
  }
  throw e;
}
