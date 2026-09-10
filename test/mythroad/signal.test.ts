import { expect, it } from 'vitest';
import { ExtRuntime } from '../../src/abi/runtime.ts';
import { MrTableBridge } from '../../src/mythroad/mr-table.ts';
import { MythroadVfs } from '../../src/mythroad/vfs.ts';
import { MR_FAILED, MR_SUCCESS } from '../../src/mythroad/constants.ts';
it('initializes, queries and closes the virtual handset signal service', () => {
  const ext = new ExtRuntime(), bridge = new MrTableBridge(ext,new MythroadVfs(),'test'); bridge.install();
  const out=ext.alloc(4),len=ext.alloc(4),args=new Uint32Array([1017,0,0,out,len,0]);
  expect(bridge.platEx(ext.mem,args)).toBe(MR_FAILED);
  expect(bridge.plat(1016,0)).toBe(MR_SUCCESS);
  expect(bridge.platEx(ext.mem,args)).toBe(MR_SUCCESS);
  const ptr=ext.mem.read32(out);expect(ext.mem.read32(len)).toBe(4);
  expect(ext.mem.slice(ptr,4)).toEqual(new Uint8Array([3,5,5,1]));
  expect(bridge.platEx(ext.mem,args)).toBe(MR_SUCCESS);expect(ext.mem.read32(out)).toBe(ptr);
  expect(bridge.plat(1018,0)).toBe(MR_SUCCESS);
  expect(bridge.platEx(ext.mem,args)).toBe(MR_FAILED);
  expect(bridge.plat(1016,0)).toBe(MR_SUCCESS);
  expect(bridge.platEx(ext.mem,new Uint32Array([1017,0,0,0,len,0]))).toBe(MR_FAILED);
});
