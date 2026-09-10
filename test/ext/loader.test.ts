import { describe, expect, it } from "vitest";
import { EXT_CODE_ADDR, EXT_TABLE_ADDR } from "../../src/abi/layout.ts";
import { isElf32, isMrpGcMap, parseExtImage, readExtHeader } from "../../src/abi/loader.ts";
import { ExtRuntime } from "../../src/abi/runtime.ts";
import {
  ARM_LOAD_HELPER_OFF,
  assembleArmHelperAt,
  buildArmLoadImage,
  buildMinimalElf32,
  withMrpGcMap,
  withRawHeader,
} from "../helpers/ext-asm.ts";

describe("4-A EXT loader", () => {
  it("fixture: MRPGCMAP header is not assumed for every image", () => {
    const helperAt = EXT_CODE_ADDR + ARM_LOAD_HELPER_OFF;
    const payload = buildArmLoadImage({
      dest: EXT_CODE_ADDR,
      helperWords: assembleArmHelperAt(helperAt, { ret0: 0x20, ret1: 0x21, ret6: 0x26, ret8: 0x28 }),
    });
    const mapped = withMrpGcMap(payload.subarray(8));
    expect(isMrpGcMap(mapped)).toBe(true);
    expect(parseExtImage(mapped).kind).toBe("mrpgcmap");
    expect(parseExtImage(payload).kind).toBe("raw");
    const elf = buildMinimalElf32(payload);
    expect(isElf32(elf)).toBe(true);
    expect(parseExtImage(elf).kind).toBe("elf");
  });

  it("fixture: MRPGCMAP maps +0 table / +4 P / +8 load", () => {
    const helperAt = EXT_CODE_ADDR + ARM_LOAD_HELPER_OFF;
    const inner = buildArmLoadImage({
      dest: EXT_CODE_ADDR,
      helperWords: assembleArmHelperAt(helperAt, { ret0: 0x20, ret1: 0x21 }),
    });
    const image = withMrpGcMap(inner.subarray(8));
    const rt = new ExtRuntime();
    const out = rt.load(image);
    expect(out.kind).toBe("return");
    const hdr = readExtHeader(rt.mem, EXT_CODE_ADDR);
    expect(hdr.table).toBe(EXT_TABLE_ADDR);
    expect(hdr.p).toBe(rt.owners.wrapper.p);
    expect(hdr.p).toBeGreaterThan(0);
    expect(hdr.load).toBe(EXT_CODE_ADDR + 8);
    expect(rt.owners.wrapper.helper).toBe(helperAt);
  });

  it("fixture: raw 8-byte hole uses the same +0/+4/+8 contract", () => {
    const helperAt = EXT_CODE_ADDR + ARM_LOAD_HELPER_OFF;
    const image = withRawHeader(
      buildArmLoadImage({
        dest: EXT_CODE_ADDR,
        helperWords: assembleArmHelperAt(helperAt, { ret0: 0x20 }),
      }).subarray(8),
    );
    const rt = new ExtRuntime();
    rt.load(image);
    expect(rt.mem.read32(EXT_CODE_ADDR)).toBe(EXT_TABLE_ADDR);
    expect(rt.mem.read32(EXT_CODE_ADDR + 4)).toBe(rt.owners.wrapper.p);
    expect(rt.owners.wrapper.helper).toBe(helperAt);
  });

  it("fixture: stripped ELF-like PT_LOAD relocates to dest", () => {
    const helperAt = EXT_CODE_ADDR + ARM_LOAD_HELPER_OFF;
    const payload = buildArmLoadImage({
      dest: EXT_CODE_ADDR,
      helperWords: assembleArmHelperAt(helperAt, { ret0: 0x20, ret1: 0x21 }),
    });
    const rt = new ExtRuntime();
    const out = rt.load(buildMinimalElf32(payload));
    expect(out.kind).toBe("return");
    expect(rt.mem.read32(EXT_CODE_ADDR)).toBe(EXT_TABLE_ADDR);
    expect(rt.owners.wrapper.helper).toBe(helperAt);
    expect(rt.owners.wrapper.p).toBeGreaterThan(0);
  });
});
