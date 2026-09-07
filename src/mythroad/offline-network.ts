import { MR_FAILED, MR_SUCCESS } from "./constants.ts";

const encoder = new TextEncoder(), decoder = new TextDecoder();
const LIMIT = 1024 * 1024;
const SERVICE_IP = 0xc0000201; // TEST-NET-1; never handed to a host socket.
const WAP_GATEWAY = 0x0a0000ac;
const concat = (...parts: Uint8Array[]) => {
  const result = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
};
const u32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b; };
const tlv = (type: number, value: Uint8Array) => concat(u32(type), u32(value.length), value);

/** Exact, bounded big-endian records used by the reference payOneAsTlv fixture. */
function records(bytes: Uint8Array): Map<number, Uint8Array> | null {
  const result = new Map<number, Uint8Array>();
  let p = 0;
  while (p < bytes.length) {
    if (bytes.length - p < 8) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset + p, 8);
    const type = view.getUint32(0), length = view.getUint32(4);
    if (length > bytes.length - p - 8 || result.has(type)) return null;
    result.set(type, bytes.slice(p + 8, p + 8 + length));
    p += 8 + length;
  }
  return result;
}

type Socket = { connected: boolean; request: Uint8Array; response: Uint8Array | null; position: number; failed: boolean };

/** In-memory adapter for the reference project's legacy service fixture.
 * No DNS, fetch, host socket, SMS, account or payment operation is performed.
 * Unknown destinations/protocols fail instead of inventing a service response.
 */
export class OfflineNetwork {
  private nextHandle = 1;
  private sockets = new Map<number, Socket>();
  readonly requests: { host: string; path: string; stage: string }[] = [];
  resolve(host: string): number { return host.toLowerCase() === "rop.skymobiapp.com" ? SERVICE_IP : MR_FAILED; }
  socket(type: number, protocol: number): number {
    if (type !== 0 || protocol !== 0 || this.sockets.size >= 16) return MR_FAILED;
    const id = this.nextHandle++;
    this.sockets.set(id, { connected: false, request: new Uint8Array(), response: null, position: 0, failed: false });
    return id;
  }
  connect(id: number, ip: number, port: number): number {
    const s = this.sockets.get(id);
    if (!s || ![SERVICE_IP, WAP_GATEWAY].includes(ip >>> 0) || port !== 80) return MR_FAILED;
    s.connected = true;
    return MR_SUCCESS;
  }
  close(id: number): number { return this.sockets.delete(id) ? MR_SUCCESS : MR_FAILED; }
  state(id: number): number { const s = this.sockets.get(id); return s?.connected && !s.failed ? MR_SUCCESS : MR_FAILED; }
  closeAll(): void { this.sockets.clear(); }
  send(id: number, bytes: Uint8Array): number {
    const s = this.sockets.get(id);
    if (!s?.connected || s.failed || s.response || bytes.length > LIMIT - s.request.length) return MR_FAILED;
    s.request = concat(s.request, bytes);
    this.respond(s);
    return s.failed ? MR_FAILED : bytes.length;
  }
  receive(id: number, length: number): Uint8Array | number {
    const s = this.sockets.get(id);
    if (!s?.connected || s.failed || !Number.isInteger(length) || length < 0 || length > LIMIT) return MR_FAILED;
    if (!s.response) return 0; // Native nonblocking socket: no data yet.
    if (s.position >= s.response.length) return MR_FAILED; // Native EOF.
    const bytes = s.response.slice(s.position, s.position + length);
    s.position += bytes.length;
    return bytes;
  }
  private respond(s: Socket): void {
    const text = decoder.decode(s.request), boundary = text.indexOf("\r\n\r\n");
    if (boundary < 0) { if (s.request.length > 16 * 1024) s.failed = true; return; }
    // Headers are ASCII, so their string/byte offsets must agree.
    if (s.request.subarray(0, boundary + 4).some(b => b > 127)) { s.failed = true; return; }
    const lines = text.slice(0, boundary).split("\r\n");
    const [method, path] = lines.shift()!.split(" ");
    const headers = new Map<string, string>();
    for (const line of lines) {
      const colon = line.indexOf(":");
      if (colon < 1) { s.failed = true; return; }
      const name = line.slice(0, colon).toLowerCase();
      if (headers.has(name)) { s.failed = true; return; }
      headers.set(name, line.slice(colon + 1).trim());
    }
    const host = (headers.get("x-online-host") ?? headers.get("host") ?? "").toLowerCase();
    const size = headers.get("content-length") ?? "0";
    if (!["rop.skymobiapp.com", "rop.skymobiapp.com:80"].includes(host) || method !== "POST" ||
        !/^\d+$/.test(size) || Number(size) > LIMIT || headers.has("transfer-encoding")) { s.failed = true; return; }
    const end = boundary + 4 + Number(size);
    if (s.request.length < end) return;
    if (s.request.length !== end) { s.failed = true; return; }
    const body = s.request.subarray(boundary + 4, end);
    let response: Uint8Array, stage = "";
    if (path === "/payOneAsTlv") {
      const fields = records(body);
      if (!fields) { s.failed = true; return; }
      stage = decoder.decode(fields.get(0x0452));
      const transaction = fields.get(0x045b);
      // Reference fixture: REG/PROP continuation echoes the transaction. No
      // forced plugin update; this local service uses the bundled v386 image.
      response = transaction?.length === 4 && ["REG", "PROP"].includes(stage)
        ? concat(tlv(101, transaction), tlv(100, u32(200)), tlv(200, new Uint8Array([12])))
        : concat(tlv(0x03f1, encoder.encode("000000006")), tlv(0x044f, u32(0)));
    } else if (path === "/payOne") {
      const form = new URLSearchParams(decoder.decode(body)), ids = form.getAll("msgid");
      if (ids.length !== 1 || !/^\d+$/.test(ids[0]) || Number(ids[0]) > 0xffffffff) { s.failed = true; return; }
      stage = "SMS-FIXTURE";
      response = concat(tlv(100, u32(200)), tlv(101, u32(Number(ids[0]))), tlv(200, new Uint8Array([1])));
    } else { s.failed = true; return; }
    if (this.requests.length < 128) this.requests.push({ host, path, stage });
    s.response = concat(encoder.encode(`HTTP/1.1 200 OK\r\nContent-Type: application/x-tar\r\nContent-Length: ${response.length}\r\nConnection: close\r\n\r\n`), response);
  }
}
