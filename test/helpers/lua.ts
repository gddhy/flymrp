import {
  CREATE_ABC,
  CREATE_ABx,
  CREATE_AsBx,
  ColdConst,
  ColdProto,
  LuaVM,
  OP_RETURN,
  TAG_NUMBER,
  TAG_STRING,
  proto,
} from "../../src/lua/index.ts";

export function kn(n: number): ColdConst {
  return { t: TAG_NUMBER, n };
}
export function ks(s: string): ColdConst {
  return { t: TAG_STRING, s };
}

export function main(code: number[], k: ColdConst[] = [], extra: Partial<ColdProto> = {}): ColdProto {
  const body = code[code.length - 1] !== undefined && (code[code.length - 1]! & 0x3f) === OP_RETURN
    ? code
    : [...code, CREATE_ABC(OP_RETURN, 0, 2, 0)];
  return proto({
    maxstack: extra.maxstack ?? 16,
    numparams: extra.numparams ?? 0,
    isVararg: extra.isVararg ?? 0,
    nups: extra.nups ?? 0,
    k,
    p: extra.p ?? [],
    code: body,
    source: extra.source ?? "@test",
  });
}

export function runMain(code: number[], k: ColdConst[] = [], extra: Partial<ColdProto> = {}): LuaVM {
  const vm = extraVm(extra);
  vm.runCold(main(code, k, extra));
  return vm;
}

export function extraVm(_extra: Partial<ColdProto>): LuaVM {
  return new LuaVM();
}

export function resultNum(vm: LuaVM, i = 0): number {
  return vm.L.nums[i]!;
}

export function resultTag(vm: LuaVM, i = 0): number {
  return vm.L.tags[i]!;
}

export { CREATE_ABC, CREATE_ABx, CREATE_AsBx, proto };
