#!/usr/bin/env npx tsx
/**
 * Stage 5-C.9 read-only probe. Does not register table[130], [38], or [33].
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderPlatex38Markdown, runPlatex38Forensics } from "../../src/real/platex38.ts";

const path = resolve(process.argv[2] ?? "test/fixtures/real/app.mrp");
const r = runPlatex38Forensics(new Uint8Array(readFileSync(path)));
console.log(renderPlatex38Markdown(r));
console.log("== JSON ==");
console.log(JSON.stringify(r, null, 2));
