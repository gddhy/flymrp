export const ExtStopKind = {
  Return: "return",
  Stop: "stop",
  Unsupported: "unsupported",
  Unmapped: "unmapped",
  InvalidSlot: "invalid-slot",
  AbiFault: "abi-fault",
} as const;

export type ExtStopKind = (typeof ExtStopKind)[keyof typeof ExtStopKind];

function retainSubclass(self: Error, proto: object): void {
  if (typeof Object.setPrototypeOf === "function") Object.setPrototypeOf(self, proto);
}

export function errorNameIs(e: unknown, name: string): boolean {
  return typeof e === "object" && e !== null && (e as { name?: unknown }).name === name;
}

export class ExtStopped extends Error {
  readonly kind: ExtStopKind;
  readonly pc: number;

  constructor(kind: ExtStopKind, pc: number, detail?: string) {
    super(`EXT ${kind} at 0x${(pc >>> 0).toString(16)}${detail ? ` (${detail})` : ""}`);
    this.name = "ExtStopped";
    this.kind = kind;
    this.pc = pc >>> 0;
    retainSubclass(this, ExtStopped.prototype);
  }
}

export class ExtFault extends Error {
  readonly kind: ExtStopKind;
  readonly pc: number;

  constructor(kind: ExtStopKind, pc: number, detail?: string) {
    super(`EXT fault ${kind} at 0x${(pc >>> 0).toString(16)}${detail ? ` (${detail})` : ""}`);
    this.name = "ExtFault";
    this.kind = kind;
    this.pc = pc >>> 0;
    retainSubclass(this, ExtFault.prototype);
  }
}

/** Firefox 48 / KaiOS: `class extends Error` often fails `instanceof`. */
export function isExtStopped(e: unknown): e is ExtStopped {
  if (e instanceof ExtStopped) return true;
  if (!e || typeof e !== "object") return false;
  const err = e as Partial<ExtStopped> & { message?: string };
  if (err.name === "ExtStopped") return true;
  return typeof err.message === "string" && err.message.indexOf("EXT return at 0x") === 0;
}

export function isExtFault(e: unknown): e is ExtFault {
  return e instanceof ExtFault || (errorNameIs(e, "ExtFault") && typeof (e as ExtFault).kind === "string");
}

export type ExtCallResult = {
  kind: ExtStopKind;
  /** Retain the guest failure location/cause for browser and batch diagnostics. */
  pc?: number;
  detail?: string;
  ret: number;
  r0: number;
  outputAddr: number;
  outputLen: number;
  output: Uint8Array;
  insnCount: number;
};
