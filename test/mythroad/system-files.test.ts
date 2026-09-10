import { expect, it } from "vitest";
import { MythroadRuntime } from "../../src/mythroad/runtime.ts";
import { ExtRuntime } from "../../src/abi/runtime.ts";

it("mounts supplied handset files in each isolated guest filesystem", () => {
  const bytes = new Uint8Array([1,2,3]);
  const a = new MythroadRuntime({ systemFiles: { "system/gb12.uc2": bytes } });
  const b = new MythroadRuntime({ systemFiles: { "system/gb12.uc2": bytes } });
  a.bindExt(new ExtRuntime()); b.bindExt(new ExtRuntime());
  expect(a.mrTable!.files.getLen("system/gb12.uc2")).toBe(3);
  const handle = a.mrTable!.files.open("system/gb12.uc2",1);
  const dest = a.ext!.alloc(3); expect(a.mrTable!.files.read(a.ext!.mem,handle,dest,3)).toBe(3);
  expect([...a.ext!.mem.slice(dest,3)]).toEqual([1,2,3]);
  a.mrTable!.appFs.file("system/gb12.uc2")![0] = 9;
  expect(b.mrTable!.appFs.file("system/gb12.uc2")![0]).toBe(1); expect(bytes[0]).toBe(1);
});
