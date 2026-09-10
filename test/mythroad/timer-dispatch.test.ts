import { expect, it, vi } from 'vitest';
import { MythroadRuntime } from '../../src/mythroad/runtime.ts';
import { ExtRuntime } from '../../src/abi/runtime.ts';

it('dispatches a Lua forwarding timer exactly once per platform event', () => {
  const rt = new MythroadRuntime(); rt.state = 1; rt.bindExt(new ExtRuntime());
  const call = vi.spyOn(rt.ext!, 'arm_ext_call').mockReturnValue({ kind: 'return', r0: 0, ret: 0, outputAddr: 0, outputLen: 0, output: new Uint8Array(), insnCount: 0 });
  rt.lua.register('dealtimer', () => {
    rt.ext!.arm_ext_call(2, new Uint8Array());
    rt.timers.start(rt.clock, 10, 'dealtimer', rt.state);
    return 0;
  });
  rt.timers.start(0, 10, 'dealtimer', rt.state);
  for (let i = 0; i < 600; i++) { rt.advance(16); while (rt.step()); }
  expect(rt.clock).toBe(9600); expect(rt.timers.fires).toBe(600);
  expect(call).toHaveBeenCalledTimes(600);
});

it('retains direct EXT timers when no Lua callback exists and surfaces faults', () => {
  const rt = new MythroadRuntime(); rt.state = 1; rt.bindExt(new ExtRuntime());
  const call = vi.spyOn(rt.ext!, 'arm_ext_call').mockReturnValue({ kind: 'return', r0: 0, ret: 0, outputAddr: 0, outputLen: 0, output: new Uint8Array(), insnCount: 0 });
  rt.timers.start(0, 10, 'dealtimer', rt.state); rt.advance(10); rt.step();
  expect(call).toHaveBeenCalledTimes(1);
  call.mockReturnValue({ kind: 'abi-fault', r0: 0, ret: 0, outputAddr: 0, outputLen: 0, output: new Uint8Array(), pc: 0x1234, insnCount: 0, detail: 'broken callback' });
  rt.timers.start(rt.clock, 10, 'dealtimer', rt.state); rt.advance(10);
  expect(() => rt.step()).toThrow('broken callback');
});
