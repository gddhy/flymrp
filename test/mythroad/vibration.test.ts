import { describe, expect, it } from 'vitest';
import { ExtRuntime } from '../../src/abi/runtime.ts';
import { EXT_CODE_ADDR, EXT_STOP_ADDR } from '../../src/abi/layout.ts';
import { MrTableBridge } from '../../src/mythroad/mr-table.ts';
import { MythroadVfs } from '../../src/mythroad/vfs.ts';
import { MR_FAILED, MR_SUCCESS } from '../../src/mythroad/constants.ts';
import { buildArmTableCaller } from '../helpers/ext-asm.ts';
describe('handset vibration ABI', () => {
  it.each([true,false])('starts, replaces and stops vibration with browser support=%s', supported => {
    const ext=new ExtRuntime(), calls:number[]=[];
    const bridge=new MrTableBridge(ext,new MythroadVfs(),'test',{onVibrate:supported?ms=>calls.push(ms):undefined});
    bridge.install();
    function invoke(slot:number,duration:number) {
      ext.pokeCode(EXT_CODE_ADDR,buildArmTableCaller({dest:EXT_CODE_ADDR,slot,r0:duration,r1:0}));
      ext.mem.write32(EXT_CODE_ADDR + 4, 0xe1a00000); // MOV r0,r0: preserve full signed duration
      const result=ext.runGuest(EXT_CODE_ADDR,{lr:EXT_STOP_ADDR,r0:duration});
      expect(result.kind).toBe('return'); return result.r0|0;
    }
    expect(invoke(55,300)).toBe(MR_SUCCESS);
    expect(invoke(55,100)).toBe(MR_SUCCESS);
    expect(invoke(55,-1)).toBe(MR_FAILED);
    expect(invoke(56,0)).toBe(MR_SUCCESS);
    expect(calls).toEqual(supported?[300,100,0]:[]);
  });
});
