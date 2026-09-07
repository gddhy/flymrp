import { it, expect, vi } from 'vitest';
import { MythroadRuntime } from '../../src/mythroad/runtime.ts';
import { ExtRuntime } from '../../src/abi/runtime.ts';
import { buildMrp } from '../../src/mrp/index.ts';

it('lets an app unpack its version before filling missing download resources', () => {
  const shared=new Uint8Array([1]), stale=new Uint8Array([9]), missing=new Uint8Array([3]);
  const rt=new MythroadRuntime({systemFiles:{'plugins/shared.mrp':shared},resourceFiles:{'game/map.txt':stale,'game/extra.bin':missing}});
  rt.loadMrp(buildMrp([{name:'start.mr',data:new Uint8Array([0])}]));
  vi.spyOn(rt.lua,'runBytes').mockImplementation(()=>{
    rt.bindExt(new ExtRuntime()); const bridge=rt.mrTable!;
    expect(bridge.appFs.file('plugins/shared.mrp')).toEqual(shared);
    // Version/extraction checks see only the game's own installed files.
    expect(bridge.appFs.info('game/map.txt')).toBeNull();
    // Explicit offline downloads remain possible during initialization.
    expect(bridge.hooks.getDownloadFile?.('game/extra.bin')).toEqual(missing);
    bridge.appFs.replace('GAME/MAP.TXT',new Uint8Array([2]));
    return 0;
  });
  rt.start();
  expect(rt.mrTable!.appFs.file('game/map.txt')).toEqual(new Uint8Array([2]));
  expect(rt.mrTable!.appFs.file('game/extra.bin')).toEqual(missing);
  rt.mrTable!.appFs.file('game/extra.bin')![0]=4;
  expect(missing[0]).toBe(3);
});

it('fills supplements when an EXT is loaded after the initial script', () => {
  const rt=new MythroadRuntime({resourceFiles:{'game/data.bin':new Uint8Array([7])}});
  rt.bindExt(new ExtRuntime());
  expect(rt.mrTable!.appFs.file('game/data.bin')).toEqual(new Uint8Array([7]));
});
