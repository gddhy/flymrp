export class FlymrpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** MRP header / index / gzip / nested archive. */
export class MrpFormatError extends FlymrpError {}

/** `\033MRP` chunk header or prototype stream. */
export class LuaChunkFormatError extends FlymrpError {}

/** Opcode / type / stack error inside the VM. */
export class LuaRuntimeError extends FlymrpError {}

/** Native C-function ABI (wrong argument type, missing required arg). */
export class NativeAbiError extends FlymrpError {}

/** Unimplemented native family/code. Subclass so existing NativeAbiError tests still match. */
export class UnknownAbiError extends NativeAbiError {
  readonly family: string;
  readonly code: string | number;
  readonly caller: string;
  constructor(
    message: string,
    info: { family: string; code: string | number; caller: string },
  ) {
    super(message);
    this.family = info.family;
    this.code = info.code;
    this.caller = info.caller;
  }
}

/** Only `mr_table` unknown slots. platEx / other families are not slot numbers. */
export function unknownTableSlot(e: unknown): number | null {
  if (e instanceof UnknownAbiError && e.family === "mr_table" && typeof e.code === "number") return e.code;
  return null;
}

/** VFS / virtual FD / ROM+RAM overlay. */
export class VfsError extends FlymrpError {}

/** Platform timer state machine. */
export class TimerError extends FlymrpError {}

/** Runtime event queue. */
export class EventError extends FlymrpError {}
