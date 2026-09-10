#!/usr/bin/env npx tsx
/**
 * Stage 5-C.8 read-only probe. Does not register table[130] or table[38].
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderCode0ChainMarkdown, runCode0ChainForensics } from "../../src/real/code0chain.ts";

const path = resolve(process.argv[2] ?? "test/fixtures/real/app.mrp");
const r = runCode0ChainForensics(new Uint8Array(readFileSync(path)));
console.log(renderCode0ChainMarkdown(r));
console.log("== JSON ==");
console.log(JSON.stringify(r, null, 2));
