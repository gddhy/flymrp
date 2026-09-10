import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { ExtRuntime } from '../../src/abi/runtime.ts';
import { MediaDevices } from '../../src/mythroad/media.ts';
import { audioDurationMs } from '../../src/mythroad/audio-duration.ts';
const mp3 = new Uint8Array(readFileSync(new URL('../fixtures/audio/sine-2s.mp3',import.meta.url)));

it('reports actual MP3 duration, millisecond progress, pause/resume offset and completion', () => {
  const ext=new ExtRuntime(); let now=0;
  const played: number[]=[];
  const media=new MediaDevices({alloc:n=>ext.alloc(n),getClock:()=>now,readFile:name=>name==='My Music/test.mp3'?mp3:null,
    play:(_type,_data,_loop,offset)=>played.push(offset ?? 0),stop:()=>{}});
  const p=ext.alloc(64),out=p+40,len=p+44;
  ext.mem.load(p,new TextEncoder().encode('My Music/test.mp3\0'));
  const call=(code:number,input=0,size=0)=>media.dispatch(ext.mem,code,input,size,out,len);
  expect(call(2090)).toBe(1); // no selected device
  expect(call(2013)).toBe(0); expect(call(2023,p,18)).toBe(0);
  expect(audioDurationMs(mp3,2)).toBeGreaterThanOrEqual(2000);
  expect(audioDurationMs(mp3,2)).toBeLessThan(2100);
  expect(call(2123)).toBe(0); expect(ext.mem.read32(ext.mem.read32(out))).toBe(2);
  expect(call(2043)).toBe(0); now=1250;
  expect(call(2153)).toBe(0); expect(ext.mem.read32(ext.mem.read32(out))).toBe(1250);
  expect(call(2133)).toBe(0); expect(ext.mem.read32(ext.mem.read32(out))).toBe(1);
  expect(call(2053)).toBe(0); now=5000;
  expect(call(2093)).toBe(1005); expect(call(2063)).toBe(0);
  expect(played).toEqual([0,1250]); now=6000;
  expect(call(2093)).toBe(1003); // finished
  expect(call(2073)).toBe(0); call(2153); expect(ext.mem.read32(ext.mem.read32(out))).toBe(0);
  expect(call(2123,0,0)).toBe(0);
  expect(media.dispatch(ext.mem,2123,0,0,0,0)).toBe(-1);
});

it('rejects truncated MP3 frames and handles empty or unrelated data', () => {
  expect(audioDurationMs(new Uint8Array(),2)).toBe(0);
  expect(audioDurationMs(new Uint8Array([255,251,144,0]),2)).toBe(0);
  expect(audioDurationMs(new Uint8Array([1,2,3]),2)).toBe(0);
});
