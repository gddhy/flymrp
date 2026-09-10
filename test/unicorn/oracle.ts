import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type OracleReq = {
  code: string;
  pc: number;
  thumb: number;
  regs: number[];
  cpsr: number;
  count?: number;
  mem?: { addr: number; hex: string }[];
  dump?: { addr: number; len: number }[];
};

export type OracleRes = {
  regs: number[];
  cpsr: number;
  error: string | null;
  mem: { addr: number; hex: string }[];
};

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "oracle.py");

let proc: ChildProcessWithoutNullStreams | null = null;
let queue: Array<(v: OracleRes) => void> = [];

function ensure(): ChildProcessWithoutNullStreams {
  if (proc) return proc;
  proc = spawn("python3", [script], { stdio: ["pipe", "pipe", "pipe"] });
  const rl = createInterface({ input: proc.stdout });
  rl.on("line", (line) => {
    const cb = queue.shift();
    if (cb) cb(JSON.parse(line) as OracleRes);
  });
  proc.stderr.on("data", (d) => {
    const s = String(d);
    if (s.trim()) console.error("[unicorn-oracle]", s);
  });
  proc.on("exit", () => {
    proc = null;
    queue = [];
  });
  return proc;
}

export function unicornStep(req: OracleReq): Promise<OracleRes> {
  return new Promise((resolve, reject) => {
    const p = ensure();
    queue.push(resolve);
    p.stdin.write(JSON.stringify(req) + "\n", (err) => {
      if (err) reject(err);
    });
  });
}

export function hexBytes(data: Uint8Array): string {
  return [...data].map((b) => b.toString(16).padStart(2, "0")).join("");
}
