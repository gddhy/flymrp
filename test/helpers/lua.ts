import {
  CREATE_ABC,
  CREATE_ABx,
  CREATE_AsBx,
  ColdConst,
  ColdProto,
  LuaVM,
  OP_RETURN,
  TAG_FUNCTION,
  TAG_NUMBER,
  TAG_STRING,
  TAG_TABLE,
  call,
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

export function invoke(vm: LuaVM, name: string, args: Array<number | string | boolean> = [], nret = 1): void {
  const g = vm.L.getGlobal(name);
  if (g.tag !== TAG_FUNCTION) throw new Error(`global ${name} is not a function`);
  vm.L.top = 0;
  vm.L.base = 1;
  vm.L.ci.length = 1;
  vm.L.ci[0]!.base = 1;
  vm.L.ci[0]!.calling = false;
  vm.L.setFn(0, g.num);
  vm.L.top = 1;
  for (const a of args) {
    if (typeof a === "string") vm.L.pushString(a);
    else if (typeof a === "boolean") vm.L.pushBoolean(a);
    else vm.L.pushInteger(a);
  }
  call(vm.L, 0, nret);
}

export function invokeField(
  vm: LuaVM,
  table: string,
  field: string,
  args: Array<number | string | boolean> = [],
  nret = 1,
): void {
  const t = vm.L.getGlobal(table);
  if (t.tag !== TAG_TABLE) throw new Error(`${table} is not a table`);
  const fn = vm.L.tables[t.num]!.getStr(vm.L.internStr(field));
  if (fn.tag !== TAG_FUNCTION) throw new Error(`${table}.${field} is not a function`);
  vm.L.top = 0;
  vm.L.base = 1;
  vm.L.ci.length = 1;
  vm.L.ci[0]!.base = 1;
  vm.L.ci[0]!.calling = false;
  vm.L.setFn(0, fn.num);
  vm.L.top = 1;
  for (const a of args) {
    if (typeof a === "string") vm.L.pushString(a);
    else if (typeof a === "boolean") vm.L.pushBoolean(a);
    else vm.L.pushInteger(a);
  }
  call(vm.L, 0, nret);
}
