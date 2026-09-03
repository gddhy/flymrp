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

/** VFS / virtual FD / ROM+RAM overlay. */
export class VfsError extends FlymrpError {}

/** Platform timer state machine. */
export class TimerError extends FlymrpError {}

/** Runtime event queue. */
export class EventError extends FlymrpError {}
