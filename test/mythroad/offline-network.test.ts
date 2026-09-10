import { describe, expect, it } from "vitest";
import { OfflineNetwork } from "../../src/mythroad/offline-network.ts";
const enc = new TextEncoder(), dec = new TextDecoder();
function record(type: number, data: Uint8Array) {
  const b = new Uint8Array(data.length + 8), v = new DataView(b.buffer);
  v.setUint32(0, type); v.setUint32(4, data.length); b.set(data, 8); return b;
}
function request(stage = "REG", host = "rop.skymobiapp.com", path = "/payOneAsTlv") {
  const body = new Uint8Array([...record(0x0452, enc.encode(stage)), ...record(0x045b, new Uint8Array([1, 2, 3, 4]))]);
  return new Uint8Array([...enc.encode(`POST ${path} HTTP/1.1\r\nHost: ${host}\r\nContent-Length: ${body.length}\r\n\r\n`), ...body]);
}
function connected() {
  const net = new OfflineNetwork(), id = net.socket(0, 0);
  expect(net.connect(id, net.resolve("rop.skymobiapp.com"), 80)).toBe(0);
  return { net, id };
}
function drain(net: OfflineNetwork, id: number) {
  const output: number[] = [];
  for (let i = 0; i < 100; i++) {
    const b = net.receive(id, 7);
    if (typeof b === "number") { expect(b).toBe(-1); return new Uint8Array(output); }
    output.push(...b);
  }
  throw Error("socket did not reach EOF");
}
describe("in-memory legacy service", () => {
  it("reassembles split headers/body and returns the reference transaction response in partial reads", () => {
    const { net, id } = connected(), bytes = request();
    expect(net.receive(id, 7)).toBe(0);
    for (let p = 0; p < bytes.length; p += 11) expect(net.send(id, bytes.slice(p, p + 11))).toBe(Math.min(11, bytes.length - p));
    const response = drain(net, id), text = dec.decode(response), body = response.slice(text.indexOf("\r\n\r\n") + 4);
    expect(text).toContain("HTTP/1.1 200 OK");
    expect([...body]).toEqual([
      0,0,0,101, 0,0,0,4, 1,2,3,4,
      0,0,0,100, 0,0,0,4, 0,0,0,200,
      0,0,0,200, 0,0,0,1, 12,
    ]);
    expect(net.requests).toEqual([{ host: "rop.skymobiapp.com", path: "/payOneAsTlv", stage: "REG" }]);
  });
  it("does not authorize preregistration or unknown stages", () => {
    for (const stage of ["PREREG", "UNKNOWN"]) {
      const { net, id } = connected(); net.send(id, request(stage));
      expect(dec.decode(drain(net, id))).toContain("000000006");
    }
  });
  it("rejects arbitrary hosts, endpoints, invalid TLV and conflicting lengths", () => {
    const bad = [request("REG", "example.com"), request("REG", undefined, "/unknown"),
      enc.encode("POST /payOneAsTlv HTTP/1.1\r\nHost: rop.skymobiapp.com\r\nContent-Length: 1\r\n\r\nx"),
      enc.encode("POST /payOneAsTlv HTTP/1.1\r\nHost: rop.skymobiapp.com\r\nContent-Length: 0\r\nContent-Length: 1\r\n\r\n")];
    for (const data of bad) { const { net, id } = connected(); expect(net.send(id, data)).toBe(-1); expect(net.requests).toEqual([]); }
  });
  it("bounds sockets/data and never opens external destinations", () => {
    const { net, id } = connected();
    expect(net.resolve("example.com")).toBe(-1);
    expect(net.connect(id, 0x08080808, 80)).toBe(-1);
    expect(net.connect(id, 0x0a0000ac, 443)).toBe(-1);
    expect(net.socket(1, 1)).toBe(-1);
    expect(net.send(id, new Uint8Array(1024 * 1024 + 1))).toBe(-1);
    for (let i = 1; i < 16; i++) expect(net.socket(0, 0)).toBeGreaterThan(0);
    expect(net.socket(0, 0)).toBe(-1);
    net.closeAll(); expect(net.receive(id, 1)).toBe(-1);
    const fresh = net.socket(0, 0); expect(fresh).toBeGreaterThan(id);
    expect(net.close(fresh)).toBe(0); expect(net.close(fresh)).toBe(-1);
  });
});
