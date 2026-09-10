import { expect, it } from 'vitest';
import { CREATE_ABC, CREATE_ABx, OP_CALL, OP_GETGLOBAL, OP_LOADK, proto } from '../../src/lua/index.ts';
import { buildMrp } from '../../src/mrp/index.ts';
import { MythroadRuntime } from '../../src/mythroad/runtime.ts';
import { MR_SOUND_MIDI } from '../../src/mythroad/constants.ts';
import { kn, ks } from '../helpers/lua.ts';

function call(rt: MythroadRuntime, name: string, args: (string | number)[]) {
  const k = [ks(name), ...args.map(arg => typeof arg === 'string' ? ks(arg) : kn(arg))];
  const code = [CREATE_ABx(OP_GETGLOBAL, 0, 0), ...args.map((_, i) => CREATE_ABx(OP_LOADK, i + 1, i + 1)), CREATE_ABC(OP_CALL, 0, args.length + 1, 1)];
  rt.lua.runCold(proto({ maxstack: args.length + 3, k, code }));
}

it('plays loaded Lua sound bytes only while enabled and running, and releases sound slots', () => {
  const played: { type: number; bytes: number[]; loop: number }[] = [], stopped: number[] = [];
  const rt = new MythroadRuntime({ onPlaySound: (type, bytes, loop) => played.push({ type, bytes: [...bytes!], loop }), onStopSound: type => stopped.push(type) });
  rt.loadMrp(buildMrp([{ name: 'music', data: new Uint8Array([77, 84, 104, 100]) }]));
  rt.state = 1;
  call(rt, 'SoundSet', [1, 'music', MR_SOUND_MIDI]);
  call(rt, 'SoundPlay', [1]); expect(played).toEqual([]);
  call(rt, '_com', [300, 1]);
  call(rt, 'SoundPlay', [1]);
  expect(played).toEqual([{ type: MR_SOUND_MIDI, bytes: [77, 84, 104, 100], loop: 0 }]);
  rt.state = 2; call(rt, 'SoundPlay', [1]); expect(played).toHaveLength(1);
  call(rt, 'SoundStop', [1]); expect(stopped).toEqual([MR_SOUND_MIDI]);
  rt.state = 1; call(rt, 'SoundSet', [1, '*']); call(rt, 'SoundPlay', [1]); expect(played).toHaveLength(1);
  expect(() => call(rt, 'SoundSet', [5, 'music'])).toThrow('Sound index');
});
