import { describe, expect, it } from "vitest";
import { EXT_STOP_ADDR, stackTop, tableSlotAddr } from "../../src/abi/layout.ts";
import { ExtRuntime } from "../../src/abi/runtime.ts";
import { ExtStopKind } from "../../src/abi/fault.ts";
import {
  MR_STATE_PAUSE,
  MR_SUCCESS,
  MR_TIMER_STATE_IDLE,
  MR_TIMER_STATE_RUNNING,
  MrTableBridge,
  MythroadTimer,
  MythroadVfs,
} from "../../src/mythroad/index.ts";

function wire() {
  const ext = new ExtRuntime();
  ext.owners.wrapper = { p: 0x0034b5c8, helper: 0x01ea5e9d };
  const bridge = new MrTableBridge(ext, new MythroadVfs(), "test");
  bridge.install();
  return { ext, bridge };
}

function call(ext: ExtRuntime, slot: number, r0 = 0) {
  return ext.runGuest(tableSlotAddr(slot), { r0, r1: 0, r2: 0, r3: 0, sp: stackTop() - 16, lr: EXT_STOP_ADDR });
}

describe("table[31]/[32] mr_timerStart / mr_timerStop ABI", () => {
  it("timerStop is zero-arg and returns MR_SUCCESS even when idle", () => {
    const { ext, bridge } = wire();
    expect(bridge.localTimer.state).toBe(MR_TIMER_STATE_IDLE);
    const out = call(ext, 32, 0x00010080);
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.r0).toBe(MR_SUCCESS);
    expect(bridge.localTimer.state).toBe(MR_TIMER_STATE_IDLE);
    expect(bridge.localTimer.stops).toBe(1);
    expect(ext.owners.timer).toEqual({ p: 0, helper: 0 });
  });

  it("timerStart(uint16) arms one-shot and records wrapper owner", () => {
    const { ext, bridge } = wire();
    bridge.clock = 10;
    const out = call(ext, 31, 50);
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.r0).toBe(MR_SUCCESS);
    expect(bridge.localTimer.state).toBe(MR_TIMER_STATE_RUNNING);
    expect(bridge.localTimer.interval).toBe(50);
    expect(bridge.localTimer.deadline).toBe(60);
    expect(bridge.localTimer.callback).toBe("dealtimer");
    expect(ext.owners.timer).toEqual({ p: 0x0034b5c8, helper: 0x01ea5e9d });
  });

  it("timerStart masks to uint16; stop clears owner", () => {
    const { ext, bridge } = wire();
    expect(call(ext, 31, 0x10032).r0).toBe(MR_SUCCESS);
    expect(bridge.localTimer.interval).toBe(0x32);
    expect(call(ext, 32, 0).r0).toBe(MR_SUCCESS);
    expect(bridge.localTimer.state).toBe(MR_TIMER_STATE_IDLE);
    expect(ext.owners.timer).toEqual({ p: 0, helper: 0 });
  });

  it("timerStart in PAUSE without runWithoutPause does not arm", () => {
    const ext = new ExtRuntime();
    const timer = new MythroadTimer();
    const bridge = new MrTableBridge(ext, new MythroadVfs(), "test", {
      getTimer: () => timer,
      getMrState: () => MR_STATE_PAUSE,
    });
    bridge.install();
    expect(call(ext, 31, 20).r0).toBe(MR_SUCCESS);
    expect(timer.state).toBe(MR_TIMER_STATE_IDLE);
    expect(ext.owners.timer).toEqual({ p: 0, helper: 0 });
  });
});
