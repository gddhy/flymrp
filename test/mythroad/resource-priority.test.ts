import { it, expect, vi } from 'vitest';
import { MythroadRuntime } from '../../src/mythroad/runtime.ts';
import { ExtRuntime } from '../../src/abi/runtime.ts';
import { buildMrp } from '../../src/mrp/index.ts';
import { MR_FILE_CREATE, MR_FILE_RDWR, MR_IS_DIR, MR_IS_FILE } from '../../src/mythroad/constants.ts';

it('keeps download caches out of installation checks and deferred game unpacking', () => {
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
  expect(rt.mrTable!.appFs.file('game/extra.bin')).toBeNull();
  expect(rt.mrTable!.hooks.getDownloadFile?.('game/extra.bin')).toEqual(missing);
  // Timer-driven unpacking can still create its own version after start().
  rt.mrTable!.appFs.replace('game/extra.bin',new Uint8Array([4]));
  expect(rt.mrTable!.hooks.getDownloadFile?.('game/extra.bin')).toEqual(new Uint8Array([4]));
  expect(missing[0]).toBe(3);
});

it('makes offline downloads available to an EXT loaded after the initial script', () => {
  const rt=new MythroadRuntime({resourceFiles:{'game/data.bin':new Uint8Array([7])}});
  rt.bindExt(new ExtRuntime());
  expect(rt.mrTable!.appFs.file('game/data.bin')).toBeNull();
  expect(rt.mrTable!.hooks.getDownloadFile?.('GAME\\DATA.BIN')).toEqual(new Uint8Array([7]));
});

it('lists cataloged system files without downloading, then loads bytes on the first read', () => {
  const loads: string[] = [];
  const rt = new MythroadRuntime({
    systemCatalog: ['plugins/netpay.mrp'],
    loadSystemFile: name => { loads.push(name); return new Uint8Array([9, 8]); },
  });
  expect(rt.appFs.info('plugins')).toBe(MR_IS_DIR);
  expect(rt.appFs.info('plugins/netpay.mrp')).toBe(MR_IS_FILE);
  expect(rt.appFs.list('plugins')).toEqual(['netpay.mrp']);
  expect(rt.vfs.exists('plugins/netpay.mrp')).toBe(true);
  expect(loads).toEqual([]);
  expect(rt.appFs.file('c:/mythroad/plugins/NETPAY.MRP')).toEqual(new Uint8Array([9, 8]));
  expect(rt.appFs.file('plugins/netpay.mrp')).toEqual(new Uint8Array([9, 8]));
  expect(loads).toEqual(['plugins/netpay.mrp']);
});

it('reports guest EFS writes and deletes for the host to persist', () => {
  const seen: [string, number[] | null][] = [];
  const rt = new MythroadRuntime({
    onPersistFile: (name, bytes) => seen.push([name, bytes ? [...bytes] : null]),
  });
  rt.appFs.replace('game.sav', new Uint8Array([1, 2]), true);
  const fd = rt.vfs.open('lua.sav', MR_FILE_RDWR | MR_FILE_CREATE);
  rt.vfs.write(fd, new Uint8Array([9, 8]));
  rt.appFs.remove('game.sav');
  expect(seen).toEqual([['game.sav', [1, 2]], ['lua.sav', [9, 8]], ['game.sav', null]]);
});

it('fetches download resources only when the offline hook reads them', () => {
  const loads: string[] = [];
  const rt = new MythroadRuntime({
    resourceCatalog: ['game/data.bin'],
    loadResourceFile: name => { loads.push(name); return new Uint8Array([7]); },
  });
  rt.bindExt(new ExtRuntime());
  expect(rt.appFs.info('game/data.bin')).toBeNull();
  expect(loads).toEqual([]);
  expect(rt.mrTable!.hooks.getDownloadFile?.('GAME\\DATA.BIN')).toEqual(new Uint8Array([7]));
  expect(loads).toEqual(['game/data.bin']);
});
