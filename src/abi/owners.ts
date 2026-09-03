/**
 * Six distinct module owners. Must not collapse into one global pointer.
 */

export type ModuleRole = "wrapper" | "primary" | "active" | "timer" | "screen" | "current";

export type ModuleRef = {
  p: number;
  helper: number;
};

export type NestedModule = {
  fileAddr: number;
  fileLen: number;
  p: number;
  helper: number;
};

export type OwnerFrame = {
  p: number;
  helper: number;
  r9: number;
  returnPc: number;
};

export class ModuleOwners {
  wrapper: ModuleRef = { p: 0, helper: 0 };
  primary: ModuleRef = { p: 0, helper: 0 };
  active: ModuleRef = { p: 0, helper: 0 };
  timer: ModuleRef = { p: 0, helper: 0 };
  screen: ModuleRef = { p: 0, helper: 0 };
  current: ModuleRef = { p: 0, helper: 0 };

  readonly nested: NestedModule[] = [];
  readonly frames: OwnerFrame[] = [];
  readonly staged: Array<{ fileAddr: number; fileLen: number }> = [];

  clear(): void {
    this.wrapper = { p: 0, helper: 0 };
    this.primary = { p: 0, helper: 0 };
    this.active = { p: 0, helper: 0 };
    this.timer = { p: 0, helper: 0 };
    this.screen = { p: 0, helper: 0 };
    this.current = { p: 0, helper: 0 };
    this.nested.length = 0;
    this.frames.length = 0;
    this.staged.length = 0;
  }

  hasSeparateWrapper(): boolean {
    return !!(this.wrapper.helper && this.primary.helper && this.wrapper.helper !== this.primary.helper);
  }

  stage(fileAddr: number, fileLen: number): void {
    this.staged.push({ fileAddr: fileAddr >>> 0, fileLen: fileLen >>> 0 });
  }

  fileRangeForLr(lr: number): { fileAddr: number; fileLen: number } | null {
    const a = (lr >>> 0) & ~1;
    for (const s of this.staged) {
      if (a >= s.fileAddr && a < s.fileAddr + s.fileLen) return s;
    }
    for (const n of this.nested) {
      if (a >= n.fileAddr && a < n.fileAddr + n.fileLen) return n;
    }
    return null;
  }

  recordNested(fileAddr: number, fileLen: number, p: number, helper: number): void {
    const existing = this.nested.find(
      (n) => n.fileAddr === (fileAddr >>> 0) && n.fileLen === (fileLen >>> 0),
    );
    if (existing) {
      existing.p = p >>> 0;
      existing.helper = helper >>> 0;
      return;
    }
    this.nested.push({
      fileAddr: fileAddr >>> 0,
      fileLen: fileLen >>> 0,
      p: p >>> 0,
      helper: helper >>> 0,
    });
  }

  findByHelper(pc: number): NestedModule | ModuleRef | null {
    const a = (pc >>> 0) & ~1;
    if ((this.wrapper.helper & ~1) === a) return this.wrapper;
    if ((this.primary.helper & ~1) === a) return this.primary;
    if ((this.active.helper & ~1) === a) return this.active;
    for (const n of this.nested) {
      if ((n.helper & ~1) === a) return n;
    }
    return null;
  }

  depth(): number {
    return this.frames.length;
  }
}
