import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { OfflineNetwork } from "../../src/mythroad/offline-network.ts";
import { DEFAULT_NETWORK_RULES, ipv4, parseNetworkRules } from "../../src/mythroad/network-rules.ts";
import { md5Bytes } from "../../src/mythroad/guest-md5.ts";
const enc = new TextEncoder(), dec = new TextDecoder();
const u32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0,n); return b; };
const tlv = (tag: number, bytes: Uint8Array) => new Uint8Array([...u32(tag), ...u32(bytes.length), ...bytes]);
function fields(bytes: Uint8Array) {
  const result = new Map<number, Uint8Array>();
  for (let p=0; p<bytes.length;) { const v=new DataView(bytes.buffer,bytes.byteOffset+p); const n=v.getUint32(4); result.set(v.getUint32(0),bytes.slice(p+8,p+8+n));p+=8+n; }
  return result;
}
function exchange(net: OfflineNetwork, host: string, request: Uint8Array, port = 80) {
  const id=net.socket(0,0); expect(net.connect(id,net.resolve(host),port)).toBe(0);
  for(let p=0;p<request.length;p+=17) expect(net.send(id,request.slice(p,p+17))).toBe(Math.min(17,request.length-p));
  const out: number[]=[];
  for(let i=0;i<10000;i++){ const chunk=net.receive(id,113); if(typeof chunk==='number'){expect(chunk).toBe(-1);break;}out.push(...chunk); }
  return new Uint8Array(out);
}
function bodyOf(response: Uint8Array) { const boundary=dec.decode(response).indexOf("\r\n\r\n"); return response.slice(boundary+4); }
describe("domain/IP interception and package downloads",()=>{
  it("recognizes every requested default hostname and literal IP, with exact host matching",()=>{
    const net=new OfflineNetwork();
    for(const host of DEFAULT_NETWORK_RULES.hosts) expect(net.resolve(host.toUpperCase()+'.')).not.toBe(-1);
    expect(net.resolve('211.155.236.18')).toBe(ipv4('211.155.236.18'));
    expect(net.resolve('rop.skymobiapp.com.example.org')).toBe(-1);
    expect(net.resolve('8.8.8.8')).toBe(-1);
  });
  it("returns binary files for exact domain/path rules and independently matches direct IP connections",()=>{
    const rules=parseNetworkRules({...DEFAULT_NETWORK_RULES,routes:[
      {host:'proxy.51mrp.com',path:'/data.bin',file:'gwy/data.bin'},
      {ip:'211.155.236.18',port:6009,path:'/other',method:'GET',file:'gwy/data.bin'}]});
    const bytes=new Uint8Array([0,255,128,13,10]); const net=new OfflineNetwork({rules,readFile:()=>bytes});
    const response=exchange(net,'proxy.51mrp.com',enc.encode('GET http://proxy.51mrp.com/data.bin HTTP/1.1\r\nHost: proxy.51mrp.com\r\n\r\n'));
    expect(bodyOf(response)).toEqual(bytes);
    const direct=exchange(net,'211.155.236.18',enc.encode('GET /other HTTP/1.0\r\nHost: old.example:6009\r\n\r\n'),6009);
    expect(bodyOf(direct)).toEqual(bytes);expect(net.interceptions.at(-1)?.result).toBe('local-file');
  });
  it("forwards a direct resource URL to the preloaded resource tree",()=>{
    const bytes=enc.encode("scene data"),net=new OfflineNetwork({readFile:name=>name==='game/scene.res'?bytes:null});
    expect(bodyOf(exchange(net,'proxy2.51mrp.com',enc.encode('GET /mythroad_res/game/scene.res HTTP/1.1\r\nHost: proxy2.51mrp.com\r\n\r\n')))).toEqual(bytes);
    expect(net.interceptions.at(-1)?.result).toBe('local-resource');
  });
  it("reconstructs the native simpleDownload envelope with exact bytes, request IDs, size and MD5",()=>{
    const bytes=enc.encode('package payload \0 unchanged'), rules=parseNetworkRules({...DEFAULT_NETWORK_RULES,packages:{'490284':'plugins/flaengine.mrp'}});
    const net=new OfflineNetwork({rules,readFile:name=>name==='plugins/flaengine.mrp'?bytes:null});
    const body=new Uint8Array([...tlv(0x2775,u32(123)),...tlv(0x29ce,u32(490284))]);
    const request=new Uint8Array([...enc.encode(`POST /simpleDownload HTTP/1.1\r\nHost: spd.skymobiapp.com:6009\r\nContent-Length: ${body.length}\r\n\r\n`),...body]);
    const response=exchange(net,'spd.skymobiapp.com',request,6009), top=fields(bodyOf(response)), meta=fields(top.get(0x2bd)!);
    expect(top.get(0x64)).toEqual(u32(200));expect(top.get(0x65)).toEqual(u32(123));expect(top.get(0x2d1)).toEqual(bytes);
    expect(meta.get(0x2be)).toEqual(u32(490284));expect(meta.get(0x2c4)).toEqual(u32(bytes.length));
    expect(Buffer.from(meta.get(0x2c5)!)).toEqual(createHash('md5').update(bytes).digest());
    expect(net.interceptions.at(-1)?.appid).toBe(490284);
    const missing=new OfflineNetwork({rules,readFile:()=>null});
    expect(dec.decode(exchange(missing,'spd.skymobiapp.com',request))).toContain('404 Not Found');
    expect(missing.interceptions.at(-1)?.result).toBe('missing-package');
  });
  it("rejects invalid settings and logs unmapped requests without fabricating a download",()=>{
    expect(()=>parseNetworkRules({...DEFAULT_NETWORK_RULES,ips:['300.1.1.1']})).toThrow();
    expect(()=>parseNetworkRules({...DEFAULT_NETWORK_RULES,routes:[{host:'proxy.51mrp.com',path:'/file',file:'../outside'}]})).toThrow();
    const net=new OfflineNetwork(),id=net.socket(0,0);net.connect(id,net.resolve('freeads.51mrp.com'),80);
    expect(net.send(id,enc.encode('GET /unknown?secret=redacted HTTP/1.1\r\nHost: freeads.51mrp.com\r\n\r\n'))).toBe(-1);
    expect(net.interceptions.at(-1)?.path).toBe('/unknown');expect(net.interceptions.at(-1)?.result).toBe('unmatched');
  });
  it("hashes payloads across MD5 block boundaries using the existing digest implementation",()=>{
    for(const size of [0,55,56,64,65,1000]){const bytes=Uint8Array.from({length:size},(_,i)=>i&255);expect(Buffer.from(md5Bytes(bytes))).toEqual(createHash('md5').update(bytes).digest());}
  });
});
