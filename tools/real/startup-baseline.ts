#!/usr/bin/env npx tsx
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderRealMrpStartupMarkdown, runRealMrpStartup } from "../../src/real/startup.ts";

const path = resolve(process.argv[2] ?? "test/fixtures/real/app.mrp");
const r = runRealMrpStartup(new Uint8Array(readFileSync(path)), {
  path,
  consistencyRuns: 3,
});
console.log(renderRealMrpStartupMarkdown(r));
