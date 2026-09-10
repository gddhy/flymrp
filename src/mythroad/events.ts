import { EventError } from "../err/errors.ts";

export const EV_TIMER = 1;
export const EV_SYSTEM = 2;
export const EV_CUSTOM = 3;
export const EV_KEY = 4;

export type RuntimeEvent = {
  kind: number;
  type: number;
  p1: number;
  p2: number;
};

const CAP = 64;

/** Typed ring buffer. Not inspected on every Lua opcode. */
export class EventQueue {
  readonly kind = new Uint8Array(CAP);
  readonly type = new Int32Array(CAP);
  readonly p1 = new Int32Array(CAP);
  readonly p2 = new Int32Array(CAP);
  head = 0;
  tail = 0;
  count = 0;

  queue(kind: number, type: number, p1 = 0, p2 = 0): void {
    if (this.count >= CAP) throw new EventError("event queue full");
    const i = this.tail;
    this.kind[i] = kind;
    this.type[i] = type;
    this.p1[i] = p1;
    this.p2[i] = p2;
    this.tail = (this.tail + 1) % CAP;
    this.count++;
  }

  /** Keep only the latest sample of a repeating sensor/key event. */
  replaceLast(kind: number, type: number, p1: number, p2: number): boolean {
    for (let n = this.count - 1; n >= 0; n--) {
      const i = (this.head + n) % CAP;
      if (this.kind[i] === kind && this.type[i] === type) {
        this.p1[i] = p1;
        this.p2[i] = p2;
        return true;
      }
    }
    return false;
  }

  poll(): RuntimeEvent | null {
    if (this.count === 0) return null;
    const i = this.head;
    const ev: RuntimeEvent = {
      kind: this.kind[i]!,
      type: this.type[i]!,
      p1: this.p1[i]!,
      p2: this.p2[i]!,
    };
    this.head = (this.head + 1) % CAP;
    this.count--;
    return ev;
  }

  clear(): void {
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }
}
