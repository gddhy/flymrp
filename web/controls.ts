export const DOM_KEY: Record<string, string> = {
  ArrowUp: "UP", ArrowDown: "DOWN", ArrowLeft: "LEFT", ArrowRight: "RIGHT",
  KeyW: "UP", KeyS: "DOWN", KeyA: "LEFT", KeyD: "RIGHT",
  Enter: "FIRE", Space: "FIRE", KeyJ: "FIRE", NumpadEnter: "FIRE",
  ShiftLeft: "SOFTLEFT", KeyQ: "SOFTLEFT", SoftLeft: "SOFTLEFT",
  Escape: "SOFTRIGHT", Backspace: "SOFTRIGHT", KeyE: "SOFTRIGHT", SoftRight: "SOFTRIGHT",
  NumpadMultiply: "STAR", NumpadDivide: "POUND",
  Digit0: "0", Digit1: "1", Digit2: "2", Digit3: "3", Digit4: "4",
  Digit5: "5", Digit6: "6", Digit7: "7", Digit8: "8", Digit9: "9",
  Numpad0: "0", Numpad1: "1", Numpad2: "2", Numpad3: "3", Numpad4: "4",
  Numpad5: "5", Numpad6: "6", Numpad7: "7", Numpad8: "8", Numpad9: "9",
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
