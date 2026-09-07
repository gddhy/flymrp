export const ExtStopKind = {
  Return: "return",
  Stop: "stop",
  Unsupported: "unsupported",
  Unmapped: "unmapped",
  InvalidSlot: "invalid-slot",
  AbiFault: "abi-fault",
} as const;

export type ExtStopKind = (typeof ExtStopKind)[keyof typeof ExtStopKind];

export class ExtStopped extends Error {
  readonly kind: ExtStopKind;
  readonly pc: number;

  constructor(kind: ExtStopKind, pc: number, detail?: string) {
    super(`EXT ${kind} at 0x${(pc >>> 0).toString(16)}${detail ? ` (${detail})` : ""}`);
    this.name = "ExtStopped";
    this.kind = kind;
    this.pc = pc >>> 0;
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
  }
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
