/** Actual timed BaiPaoFen A/B run. No score or guest-code modifications.
 * Usage: npx tsx tools/real/benchmark-perf.ts /absolute/baipaofenv1.1.5.mrp output.json
 * Run without other CPU-heavy work; browser scores depend on its JS engine. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { MythroadRuntime, loadGb16Uc2 } from '../../src/mythroad/index.ts';
import { SYSTEM_COMPONENTS } from '../../src/mythroad/system-components.ts';
const [path, output] = process.argv.slice(2);
if (!path || !output) throw new Error('Expected MRP path and report path');
const bytes=readFileSync(path);
const systemFiles=Object.fromEntries(SYSTEM_COMPONENTS.map(name=>[name,readFileSync(new URL('../../assets/'+name,import.meta.url))]));
loadGb16Uc2(systemFiles['system/gb16.uc2']);
const runs=[];
for (const compiled of [false,true,false,true]) {
  const rt=new MythroadRuntime({systemFiles, monotonicTime:()=>performance.now()});
  const scores:Record<string,number>={}; const bind=rt.bindExt.bind(rt);
  rt.bindExt=ext=>{
    bind(ext); if(!ext)return; ext.cache.compileBlocks=compiled;
    const bridge=rt.mrTable!,format=bridge.sprintf.bind(bridge);
    bridge.sprintf=(mem,args)=>{
      const n=format(mem,args),text=new TextDecoder('gbk').decode(mem.slice(args[0],Math.min(n,400)));
      const match=/^(综合|累计|运算|排序|内存):\s*(\d+)/.exec(text);
      if(match)scores[match[1]]=Number(match[2]); return n;
    };
  };
  const tick=(n:number)=>{for(let i=0;i<n;i++){rt.advance(80);for(let j=0;j<16&&rt.step();j++);}};
  const tap=(key:string)=>{rt.input.press(key);tick(3);rt.input.release(key);tick(5);};
  const start=performance.now(); rt.loadMrp(bytes);rt.start();tick(50);
  tap('SOFTLEFT');tap('SOFTRIGHT');tap('FIRE');tick(100);
  if(Object.keys(scores).length!==5)throw new Error('Benchmark did not display all scores');
  const result={compiled,elapsedMs:Math.round(performance.now()-start),scores}; runs.push(result); console.log(result);
}
writeFileSync(output,JSON.stringify({node:process.version,arch:process.arch,sha256:createHash('sha256').update(bytes).digest('hex'),method:'same-runtime-monotonic-clock-interpreter-versus-compiled-blocks',runs},null,2)+'\n');
