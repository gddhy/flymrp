#!/usr/bin/env npx tsx
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderCode6Markdown, runCode6Forensics } from "../../src/real/code6.ts";

const path = resolve(process.argv[2] ?? "test/fixtures/real/app.mrp");
const bytes = new Uint8Array(readFileSync(path));
const r = runCode6Forensics(bytes);
console.log(renderCode6Markdown(r));
console.log("\n== JSON slots / loads ==");
console.log(JSON.stringify({ loads: r.loads, preCall: r.preCall, fault: r.fault }, null, 2));
