export const DOM_KEY: Record<string, string> = {
  ArrowUp: "UP", ArrowDown: "DOWN", ArrowLeft: "LEFT", ArrowRight: "RIGHT",
  KeyW: "UP", KeyS: "DOWN", KeyA: "LEFT", KeyD: "RIGHT",
  Enter: "FIRE", Space: "FIRE", KeyJ: "FIRE", NumpadEnter: "FIRE",
  ShiftLeft: "SOFTLEFT", KeyQ: "SOFTLEFT", SoftLeft: "SOFTLEFT",
  Escape: "SOFTRIGHT", Backspace: "SOFTRIGHT", KeyE: "SOFTRIGHT", SoftRight: "SOFTRIGHT",
  NumpadMultiply: "STAR", NumpadDivide: "POUND",
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`Digit${i}`, String(i)])),
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`Numpad${i}`, String(i)])),
};

/** Multiple physical keys/pointers may own one phone key; release only the last owner. */
export class HeldKeys {
  private readonly sources = new Map<string, string>();
  constructor(private readonly pressKey: (key: string) => void, private readonly releaseKey: (key: string) => void) {}
  press(source: string, key: string): void {
    if (this.sources.has(source)) return;
    const held = [...this.sources.values()].includes(key);
    this.sources.set(source, key);
    if (!held) this.pressKey(key);
  }
  release(source: string): void {
    const key = this.sources.get(source);
    if (key === undefined) return;
    this.sources.delete(source);
    if (![...this.sources.values()].includes(key)) this.releaseKey(key);
  }
  clear(): void { for (const source of [...this.sources.keys()]) this.release(source); }
}
