import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { crc32 } from "../../src/mrp/gzip.ts";
import { loadGb16Uc2, MythroadRuntime } from "../../src/mythroad/index.ts";
import { inferScreenSize } from "../../src/mythroad/device-size.ts";

type Game = { id: number; path: string; sha256: string; required?: boolean };
type Action = { key: string; hold?: number; wait?: number };
type Scenario = { entry?: Action[]; controls?: Action[]; bootTicks?: number; tailTicks?: number; gameplaySha256?: string[]; reviewNote?: string };
const manifestPath = resolve("docs/compatibility/collection-100.json");
const scenarioPath = resolve("docs/compatibility/scenarios.json");
const manifest = JSON.parse(readFileSync(manifestPath,"utf8"));
const allGames: Game[] = [...manifest.requiredGames,...manifest.selected];
const scenarios: Record<string, Scenario> = existsSync(scenarioPath) ? JSON.parse(readFileSync(scenarioPath,"utf8")) : {};
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const args = process.argv.slice(2), worker = args[0] === "--worker";
const root = resolve(worker ? args[2] : args[0] ?? process.env.MRP_GAME_DIR ?? "/Users/zixing/Downloads/mrp游戏大集结");
const output = resolve(worker ? args[3] : args[1] ?? "artifacts/collection-current");
mkdirSync(output,{recursive:true});

/** Lossless capture of the emulator's RGB565 framebuffer, with no rescaling. */
function png(width: number,height: number,pixels: Uint16Array): Buffer {
  const rows=Buffer.alloc((width*3+1)*height);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const c=pixels[y*width+x],off=y*(width*3+1)+1+x*3;
    rows[off]=Math.round(((c>>>11)&31)*255/31); rows[off+1]=Math.round(((c>>>5)&63)*255/63); rows[off+2]=Math.round((c&31)*255/31);
  }
  const chunk=(type:string,data:Buffer)=>{const name=Buffer.from(type),head=Buffer.alloc(4),crc=Buffer.alloc(4);head.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([head,name,data,crc]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",header),chunk("IDAT",deflateSync(rows)),chunk("IEND",Buffer.alloc(0))]);
}

if(worker) {
  const game=allGames.find(g=>g.id===Number(args[1])); if(!game) throw new Error("unknown manifest id");
  const path=join(root,game.path),bytes=readFileSync(path);
  if(hash(bytes)!==game.sha256) throw new Error("game content differs from frozen manifest");
  const scenario=scenarios[String(game.id)]??{},profile=inferScreenSize(game.path);
  loadGb16Uc2(readFileSync("assets/system/gb16.uc2"));
  const systemFiles = Object.fromEntries(["gb16.uc2", "gb12.uc2", "gb12_uc2.adl", "gb16_uc2.adl"].map(name => [`system/${name}`, readFileSync(`assets/system/${name}`)]));
  const rt=new MythroadRuntime({profile,abiMode:"strict",systemFiles});
  let phase="load",ticks=0,inputChanges=0,keysTested=0,error:string|null=null;
  const distinct=new Set<string>();
  const fingerprint=()=>hash(new Uint8Array(rt.screen.pixels.buffer,rt.screen.pixels.byteOffset,rt.screen.pixels.byteLength));
  const checkpoints: {name:string;sha256:string;image:string;clock:number;colors:number}[]=[];
  const capture=(name:string)=>{
    const sha256=fingerprint(),image=`${game.id}-${name}.png`;
    writeFileSync(join(output,image),png(rt.screenW,rt.screenH,rt.screen.pixels));
    checkpoints.push({name,sha256,image,clock:rt.clock,colors:new Set(rt.screen.pixels).size});
    writeFileSync(join(output,`${game.id}-progress.json`),JSON.stringify({phase,ticks,keysTested,checkpoints}));
  };
  const tick=(count:number)=>{for(let i=0;i<count;i++){rt.advance(80);for(let n=0;n<16&&rt.step();n++);if(rt.exited)throw new Error("guest exited");ticks++;if(ticks%5===0)distinct.add(fingerprint());}};
  const tap=(action:Action)=>{const before=fingerprint();rt.input.press(action.key);tick(action.hold??3);rt.input.release(action.key);tick(action.wait??10);keysTested++;if(before!==fingerprint())inputChanges++;};
  const startedAt=Date.now();
  try {
    rt.loadMrp(bytes);phase="start";rt.start();phase="boot";tick(scenario.bootTicks??50);capture("boot");
    phase="entry";
    const entry=scenario.entry??[{key:"SOFTLEFT"},{key:"FIRE"},{key:"FIRE"},{key:"FIRE"}];
    for(const [index,action] of entry.entries()){tap(action);capture(`entry${index+1}`);}
    phase="controls";
    for(const action of scenario.controls??["UP","RIGHT","DOWN","LEFT","2","6","8","4","5"].map(key=>({key,hold:5,wait:10})))tap(action);
    capture("controls");phase="sustained";
    tick(Math.max(scenario.tailTicks??750,750));capture("sustained");phase="complete";
  } catch(e) {error=e instanceof Error?`${e.name}: ${e.message}`:String(e);capture("failure");}
  const nonBlack=rt.screen.pixels.some(p=>p!==0),expected=scenario.gameplaySha256??[];
  const sceneVerified=expected.length>0&&checkpoints.some(c=>expected.includes(c.sha256));
  const outcome=rt.exited?"exited":error?"runtime-error":!nonBlack?"black-screen":inputChanges===0?"no-input-response":!sceneVerified?"needs-scene-review":"passed";
  console.log(JSON.stringify({...game,...profile,outcome,phase,error,ticks,keysTested,inputChanges,distinctFrames:distinct.size,nonBlack,sceneVerified,
    checkpoints,exited:rt.exited,unknownSlot:rt.unknownRequiredSlot,unknownEvents:rt.unknownEvents,elapsedMs:Date.now()-startedAt,debugOutput:rt.ext?.debugOutput??""}));
} else {
  const onlyArg=args.find(a=>a.startsWith("--only="));
  const only=onlyArg?new Set(onlyArg.slice(7).split(",").map(Number)):null;
  const games=only?allGames.filter(g=>only.has(g.id)):allGames;
  if(!games.length)throw new Error("no matching cases");
  const revision=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
  const diff=execFileSync("git",["diff"],{encoding:"utf8"});
  const meta={revision,workingDiffSha256:hash(diff),manifestSha256:hash(readFileSync(manifestPath)),scenarioSha256:existsSync(scenarioPath)?hash(readFileSync(scenarioPath)):null,
    startedAt:new Date().toISOString(),requiredCount:allGames.length,selectedCount:games.length,method:"frozen-content-confirm-controls-60s-scene-review-v1"};
  const results: any[]=[];
  const save=()=>writeFileSync(join(output,"results.json"),JSON.stringify({...meta,complete:results.length===games.length,
    allPassed:results.length===allGames.length&&results.every(r=>r.outcome==="passed"),results:[...results].sort((a,b)=>a.id-b.id)},null,2)+"\n");
  save();
  let next=0;
  const runOne=(game:Game)=>new Promise<void>(resolveDone=>{
    const start=Date.now(),child=spawn(process.execPath,["--import","tsx",fileURLToPath(import.meta.url),"--worker",String(game.id),root,output],{stdio:["ignore","pipe","pipe"]});
    let stdout="",stderr="",timedOut=false;
    const timeout=setTimeout(()=>{timedOut=true;child.kill("SIGKILL");},120_000);
    child.stdout.on("data",data=>{stdout+=data;});child.stderr.on("data",data=>{stderr=(stderr+data).slice(-10000);});
    child.on("error",e=>{stderr+=String(e);});
    child.on("close",()=>{
      clearTimeout(timeout);let row:any;
      try {row=JSON.parse(stdout.trim().split("\n").at(-1)!);}catch{
        row={...game,outcome:timedOut?"worker-timeout":"worker-error",error:stderr,elapsedMs:Date.now()-start};
        const progress=join(output,`${game.id}-progress.json`);if(existsSync(progress))row.progress=JSON.parse(readFileSync(progress,"utf8"));
      }
      results.push(row);save();console.log(`[${results.length}/${games.length}] #${game.id} ${basename(game.path)}: ${row.outcome}${row.error?` ${row.error}`:""}`);resolveDone();
    });
  });
  await Promise.all(Array.from({length:3},async()=>{while(next<games.length){const game=games[next++];await runOne(game);}}));
  process.exitCode=results.length===allGames.length&&results.every(r=>r.outcome==="passed")?0:1;
}
