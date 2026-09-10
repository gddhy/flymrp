#!/usr/bin/env npx tsx
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderTestCom130Markdown, runTestCom130Forensics } from "../../src/real/testcom130.ts";

const path = resolve(process.argv[2] ?? "test/fixtures/real/app.mrp");
const r = runTestCom130Forensics(new Uint8Array(readFileSync(path)));
console.log(renderTestCom130Markdown(r));
console.log("== JSON ==");
console.log(JSON.stringify(r, null, 2));
