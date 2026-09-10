#!/usr/bin/env npx tsx
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { discoverRealBinaries, gateMarkdown, inspectBytes, loaderReadiness } from "../../src/real/index.ts";

const arg = process.argv[2];
if (!arg) {
  const found = discoverRealBinaries(resolve("test/fixtures/real"));
  if (found.length) {
    console.log("fixture present (not real-app green)");
    console.log("usage: npx tsx tools/real/inspect.ts <file.mrp|file.mr|file.ext>");
    console.log("discovered in test/fixtures/real:", found.join(", "));
  } else {
    console.log("REAL_BINARY_BLOCKED");
    console.log("usage: npx tsx tools/real/inspect.ts <file.mrp|file.mr|file.ext>");
    console.log("discovered in test/fixtures/real: (none)");
  }
  console.log("");
  for (const i of loaderReadiness()) console.log(`${i.status.padEnd(8)} ${i.item} — ${i.reason}`);
  process.exit(found.length ? 0 : 2);
}

const path = resolve(arg);
if (!existsSync(path)) {
  console.error(`not found: ${path}`);
  process.exit(2);
}
const bytes = new Uint8Array(readFileSync(path));
const info = inspectBytes(bytes, { name: path, fixtureKind: "real" });
console.log(JSON.stringify(info, null, 2));
console.log("");
console.log(gateMarkdown({ bytes, path, fixtureKind: "real", steps: 0 }));
