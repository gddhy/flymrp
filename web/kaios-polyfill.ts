/** Firefox 48 / KaiOS 2.x shims. Safe to install on modern browsers. */
export function installKaiOSPolyfills(): void {
  const root = typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : undefined;
  if (root && !("globalThis" in root)) Object.defineProperty(root, "globalThis", { value: root, configurable: true });

  const array = Array.prototype as unknown as {
    at?(index: number): unknown;
    flat?(depth?: number): unknown[];
    flatMap?(fn: (value: unknown, index: number, array: unknown[]) => unknown, thisArg?: unknown): unknown[];
  };
  if (!array.at) {
    array.at = function (this: unknown[], index: number): unknown {
      const k = (index | 0) >= 0 ? (index | 0) : this.length + (index | 0);
      return k < 0 || k >= this.length ? undefined : this[k];
    };
  }
  if (!array.flat) {
    array.flat = function (this: unknown[], depth = 1): unknown[] {
      const out: unknown[] = [];
      const walk = (items: unknown[], rest: number): void => {
        for (const item of items) {
          if (rest > 0 && Array.isArray(item)) walk(item, rest - 1);
          else out.push(item);
        }
      };
      walk(this, depth);
      return out;
    };
  }
  if (!array.flatMap) {
    array.flatMap = function (this: unknown[], fn: (value: unknown, index: number, array: unknown[]) => unknown, thisArg?: unknown) {
      return (this.map(fn, thisArg) as unknown[]).flat();
    };
  }
  if (!Object.fromEntries) {
    Object.fromEntries = (entries: Iterable<readonly [PropertyKey, unknown]>): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const entry of entries) out[entry[0] as string] = entry[1];
      return out;
    };
  }
  if (!String.prototype.replaceAll) {
    String.prototype.replaceAll = function (this: string, search: string | RegExp, replacement: string | ((substring: string, ...args: unknown[]) => string)): string {
      if (search instanceof RegExp) return this.replace(search, replacement as string);
      return this.split(search).join(replacement as string);
    };
  }
  if (!String.prototype.matchAll) {
    String.prototype.matchAll = function (this: string, regexp: RegExp): IterableIterator<RegExpExecArray> {
      const flags = regexp.flags.indexOf("g") >= 0 ? regexp.flags : `${regexp.flags}g`;
      const copy = new RegExp(regexp.source, flags);
      const matches: RegExpExecArray[] = [];
      let match: RegExpExecArray | null;
      while ((match = copy.exec(this))) matches.push(match);
      return matches[Symbol.iterator]();
    } as String["matchAll"];
  }
  if (typeof Element !== "undefined") {
    if (!Element.prototype.replaceChildren) {
      Element.prototype.replaceChildren = function (...nodes: (Node | string)[]): void {
        while (this.firstChild) this.removeChild(this.firstChild);
        for (const node of nodes) this.appendChild(typeof node === "string" ? document.createTextNode(node) : node);
      };
    }
    if (!Element.prototype.append) {
      Element.prototype.append = function (...nodes: (Node | string)[]): void {
        for (const node of nodes) this.appendChild(typeof node === "string" ? document.createTextNode(node) : node);
      };
    }
  }
  if (typeof NodeList !== "undefined" && !NodeList.prototype.forEach) {
    (NodeList.prototype as unknown as { forEach: typeof Array.prototype.forEach }).forEach = Array.prototype.forEach;
  }
}

installKaiOSPolyfills();
