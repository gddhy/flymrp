import { expect, it } from 'vitest';
import { ExtRuntime } from '../../src/abi/runtime.ts';
import { buildMrp, MRPArchive } from '../../src/mrp/index.ts';
import { MrTableBridge, writeFixedCString } from '../../src/mythroad/mr-table.ts';
import { MythroadVfs } from '../../src/mythroad/vfs.ts';

it('reads a selected extracted plugin archive and restores the outer resource namespace', () => {
  const outer = buildMrp([{ name: 'shared', data: new Uint8Array([1]) }, { name: 'outer-only', data: new Uint8Array([9]) }], { filename: 'outer.mrp' });
  const inner = buildMrp([{ name: 'shared', data: new Uint8Array([2, 3]), gzip: true }]);
  const ext = new ExtRuntime(), vfs = new MythroadVfs(); vfs.attach(MRPArchive.parse(outer));
  const bridge = new MrTableBridge(ext, vfs, 'selected-pack', { getPack: () => ({ name: 'outer.mrp', bytes: outer }) });
  bridge.install(); bridge.appFs.replace('pg/plugin.mrp', inner);
  const name = ext.alloc(32), len = ext.alloc(4);
  const read = (filename: string, mode = 0) => { writeFixedCString(ext.mem, name, filename, 32); return bridge.readFile(ext.mem, name, len, mode); };
  ext.setPackTableName('pg/plugin.mrp');
  expect(read('shared', 1)).toBe(1);
  const nested = read('shared');
  expect(ext.mem.read32(len)).toBe(2);
  expect([...ext.mem.slice(nested, 2)]).toEqual([2, 3]);
  expect(read('outer-only')).toBe(0);
  expect(read('outer-only', 1)).toBe(0);
  ext.setPackTableName('outer.mrp');
  expect([...ext.mem.slice(read('shared'), 1)]).toEqual([1]);
  expect(read('outer-only', 1)).toBe(1);
});
