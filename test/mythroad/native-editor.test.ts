import { describe, expect, it } from "vitest";
import { ExtRuntime } from "../../src/abi/runtime.ts";
import { MrTableBridge } from "../../src/mythroad/mr-table.ts";
import { MythroadVfs } from "../../src/mythroad/vfs.ts";
import { tableSlotAddr } from "../../src/abi/layout.ts";
import { MR_KEY_PRESS, MR_KEY_RELEASE, MR_KEY_SOFTLEFT, MR_KEY_SOFTRIGHT } from "../../src/mythroad/constants.ts";
function setup(){
  const ext=new ExtRuntime(), completions:boolean[]=[];
  const bridge=new MrTableBridge(ext,new MythroadVfs(),'editor',{onEditComplete:ok=>completions.push(ok)});bridge.install();
  const str=(s:string)=>{const p=ext.alloc((s.length+1)*2);for(let i=0;i<s.length;i++){ext.mem.write8(p+i*2,s.charCodeAt(i)>>>8);ext.mem.write8(p+i*2+1,s.charCodeAt(i)&255);}return p;};
  const call=(slot:number,r0=0,r1=0,r2=0,r3=0)=>ext.runGuest(tableSlotAddr(slot),{r0,r1,r2,r3}).r0|0;
  return {ext,bridge,str,call,completions};
}
describe('native UCS2 text editor',()=>{
  it('creates through table 75, returns stable UCS2-BE bytes through 77 and invalidates on release',()=>{
    const {ext,bridge,str,call,completions}=setup();const id=call(75,str('角色名'),str('小明'),0,4);
    expect(id).toBeGreaterThan(0);expect(bridge.editor.active?.title).toBe('角色名');
    const pointer=call(77,id);expect([...ext.mem.slice(pointer,6)]).toEqual([0x5c,0x0f,0x66,0x0e,0,0]);
    expect(bridge.editor.finish('英雄123',true)).toBe(true);expect(completions).toEqual([true]);expect(call(77,id)).toBe(pointer);
    expect([...ext.mem.slice(pointer,10)]).toEqual([0x82,0xf1,0x96,0xc4,0,49,0,50,0,0]);
    expect(call(76,id)).toBe(0);expect(call(77,id)).toBe(0);expect(call(76,id)).toBe(-1);
  });
  it('consumes modal key input and the confirmation key release exactly once',()=>{
    const {bridge,str,call,completions}=setup();call(75,str('编号'),str(''),1,3);
    expect(bridge.editor.key(MR_KEY_PRESS,2)).toBe(true);expect(bridge.editor.active?.text).toBe('2');
    expect(bridge.editor.key(MR_KEY_PRESS,MR_KEY_SOFTLEFT)).toBe(true);expect(completions).toEqual([true]);
    expect(bridge.editor.key(MR_KEY_RELEASE,MR_KEY_SOFTLEFT)).toBe(true);
    expect(bridge.editor.key(MR_KEY_RELEASE,MR_KEY_SOFTLEFT)).toBe(false);
    call(75,str('取消'),str('原值'),0,3);bridge.editor.key(MR_KEY_PRESS,MR_KEY_SOFTRIGHT);expect(completions).toEqual([true,false]);
  });
  it('bounds allocations and rejects invalid edit types and handles',()=>{
    const {str,call}=setup();expect(call(75,str(''),0,0,0)).toBe(-1);expect(call(75,str(''),0,8,20)).toBe(-1);
    expect(call(75,str(''),0,0,4097)).toBe(-1);expect(call(77,999)).toBe(0);
  });
});
