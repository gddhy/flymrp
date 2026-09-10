import { describe, expect, it } from 'vitest';
import { LuaRuntimeError, UnknownAbiError } from '../../src/err/errors.ts';
import { LuaVM, call, TAG_BOOL, TAG_NIL, TAG_NUMBER } from '../../src/lua/index.ts';

function invokeProtected(vm: LuaVM, name: string): void {
  const L = vm.L;
  L.top = 0; L.base = 1;
  L.pushSlot(L.getGlobal('pcall')); L.pushSlot(L.getGlobal(name)); L.pushInteger(17);
  call(L, 0, -1);
}
describe('Lua protected calls', () => {
  it('prepends success and preserves multiple return values including nil', () => {
    const vm = new LuaVM();
    vm.register('f', L => { const n = L.optNumber(1, 0); L.pushInteger(n); L.pushNil(); L.pushInteger(19); return 3; });
    invokeProtected(vm, 'f');
    expect([...vm.L.tags.slice(0,4)]).toEqual([TAG_BOOL,TAG_NUMBER,TAG_NIL,TAG_NUMBER]);
    expect([...vm.L.nums.slice(0,4)]).toEqual([1,17,0,19]);
    expect(vm.L.top).toBe(4);
  });
  it('unwinds a failed call and permits another call on the same state', () => {
    const vm = new LuaVM(); vm.register('bad', () => { throw new LuaRuntimeError('expected failure'); });
    invokeProtected(vm, 'bad');
    expect(vm.L.nums[0]).toBe(0);
    expect(vm.L.strings[vm.L.nums[1]]).toBe('expected failure');
    expect(vm.L.ci.length).toBe(1); expect(vm.L.nCcalls).toBe(0);
    vm.register('good', L => { L.pushInteger(42); return 1; });
    invokeProtected(vm, 'good'); expect(vm.L.nums[1]).toBe(42);
  });
  it('does not turn missing emulator interfaces into successful compatibility results', () => {
    const vm = new LuaVM(); vm.register('bad', () => { throw new UnknownAbiError('missing', {family:'test',code:55,caller:'test'}); });
    expect(() => invokeProtected(vm, 'bad')).toThrow(UnknownAbiError);
  });
});
