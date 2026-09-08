/** Firefox 48 / KaiOS 2.x shims. Safe to install on modern browsers. */

type Indexable = { length: number; [index: number]: unknown };

function host(): typeof globalThis | undefined {
  if (typeof globalThis !== "undefined") return globalThis;
  if (typeof self !== "undefined") return self as unknown as typeof globalThis;
  if (typeof window !== "undefined") return window as unknown as typeof globalThis;
  return undefined;
}

function padText(value: unknown, maxLength: number, fill: unknown, atEnd: boolean): string {
  const text = String(value);
  const width = maxLength >>> 0;
  if (width <= text.length) return text;
  let fillText = fill === undefined || fill === null ? " " : String(fill);
  if (!fillText) return text;
  let pad = "";
  const need = width - text.length;
  while (pad.length < need) pad += fillText;
  pad = pad.slice(0, need);
  return atEnd ? text + pad : pad + text;
}

function atIndex(this: Indexable, index: number): unknown {
  const i = index | 0;
  const k = i >= 0 ? i : this.length + i;
  return k < 0 || k >= this.length ? undefined : this[k];
}

function includesValue(this: Indexable, value: unknown, fromIndex?: number): boolean {
  const len = this.length >>> 0;
  let i = fromIndex === undefined ? 0 : fromIndex | 0;
  if (i < 0) i = Math.max(0, len + i);
  for (; i < len; i++) {
    const cur = this[i];
    if (cur === value || (cur !== cur && value !== value)) return true;
  }
  return false;
}

function installAt(proto: { at?: (index: number) => unknown } | undefined): void {
  if (proto && !proto.at) proto.at = atIndex;
}

function typedArrayCtors(root: typeof globalThis): Array<{ prototype: object }> {
  const names = ["Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array", "Uint32Array", "Float32Array", "Float64Array"];
  const out: Array<{ prototype: object }> = [];
  for (let i = 0; i < names.length; i++) {
    const ctor = (root as unknown as Record<string, { prototype?: object } | undefined>)[names[i]!];
    if (ctor && ctor.prototype) out.push(ctor as { prototype: object });
  }
  return out;
}

export function installKaiOSPolyfills(): void {
  const root = host();
  if (root && !("globalThis" in root)) Object.defineProperty(root, "globalThis", { value: root, configurable: true });

  const array = Array.prototype as unknown as {
    at?(index: number): unknown;
    includes?(value: unknown, fromIndex?: number): boolean;
    find?(fn: (value: unknown, index: number, array: unknown[]) => unknown, thisArg?: unknown): unknown;
    findIndex?(fn: (value: unknown, index: number, array: unknown[]) => unknown, thisArg?: unknown): number;
    fill?(value: unknown, start?: number, end?: number): unknown[];
    copyWithin?(target: number, start: number, end?: number): unknown[];
    flat?(depth?: number): unknown[];
    flatMap?(fn: (value: unknown, index: number, array: unknown[]) => unknown, thisArg?: unknown): unknown[];
  };

  if (!array.at) array.at = atIndex;
  if (!array.includes) array.includes = includesValue;
  if (!array.find) {
    array.find = function (this: unknown[], fn: (value: unknown, index: number, array: unknown[]) => unknown, thisArg?: unknown) {
      for (let i = 0; i < this.length; i++) if (fn.call(thisArg, this[i], i, this)) return this[i];
      return undefined;
    };
  }
  if (!array.findIndex) {
    array.findIndex = function (this: unknown[], fn: (value: unknown, index: number, array: unknown[]) => unknown, thisArg?: unknown) {
      for (let i = 0; i < this.length; i++) if (fn.call(thisArg, this[i], i, this)) return i;
      return -1;
    };
  }
  if (!array.fill) {
    array.fill = function (this: unknown[], value: unknown, start?: number, end?: number) {
      const len = this.length >>> 0;
      let from = start === undefined ? 0 : start | 0;
      let to = end === undefined ? len : end | 0;
      if (from < 0) from = Math.max(0, len + from);
      if (to < 0) to = Math.max(0, len + to);
      for (let i = from; i < to && i < len; i++) this[i] = value;
      return this;
    };
  }
  if (!array.copyWithin) {
    array.copyWithin = function (this: unknown[], target: number, start: number, end?: number) {
      const len = this.length >>> 0;
      let to = target | 0, from = start | 0, last = end === undefined ? len : end | 0;
      if (to < 0) to = Math.max(0, len + to);
      if (from < 0) from = Math.max(0, len + from);
      if (last < 0) last = Math.max(0, len + last);
      const count = Math.min(last - from, len - to);
      if (count > 0) {
        const slice = this.slice(from, from + count);
        for (let i = 0; i < count; i++) this[to + i] = slice[i];
      }
      return this;
    };
  }
  if (!array.flat) {
    array.flat = function (this: unknown[], depth?: number): unknown[] {
      const rest = depth === undefined ? 1 : depth;
      const out: unknown[] = [];
      const walk = (items: unknown[], n: number): void => {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (n > 0 && Object.prototype.toString.call(item) === "[object Array]") walk(item as unknown[], n - 1);
          else out.push(item);
        }
      };
      walk(this, rest);
      return out;
    };
  }
  if (!array.flatMap) {
    array.flatMap = function (this: unknown[], fn: (value: unknown, index: number, array: unknown[]) => unknown, thisArg?: unknown) {
      return (this.map(fn, thisArg) as unknown[]).flat();
    };
  }

  if (typeof Array.from !== "function") {
    Array.from = function <T>(items: ArrayLike<T>, mapFn?: (value: T, index: number) => unknown, thisArg?: unknown): unknown[] {
      const list = Object(items) as ArrayLike<T>;
      const out: unknown[] = [];
      for (let i = 0; i < list.length; i++) out.push(mapFn ? mapFn.call(thisArg, list[i] as T, i) : list[i]);
      return out;
    } as typeof Array.from;
  }
  if (typeof Array.of !== "function") {
    Array.of = function (): unknown[] {
      const out: unknown[] = [];
      for (let i = 0; i < arguments.length; i++) out.push(arguments[i]);
      return out;
    } as typeof Array.of;
  }

  if (!Object.assign) {
    Object.assign = function (target: object): object {
      const dest = Object(target) as Record<string, unknown>;
      for (let i = 1; i < arguments.length; i++) {
        const src = arguments[i];
        if (src == null) continue;
        const object = Object(src) as Record<string, unknown>;
        const keys = Object.keys(object);
        for (let j = 0; j < keys.length; j++) dest[keys[j]!] = object[keys[j]!];
      }
      return dest;
    };
  }
  if (!Object.entries) {
    Object.entries = (value: object): [string, unknown][] => {
      const object = Object(value) as Record<string, unknown>;
      const keys = Object.keys(object);
      const out: [string, unknown][] = [];
      for (let i = 0; i < keys.length; i++) out.push([keys[i]!, object[keys[i]!]]);
      return out;
    };
  }
  if (!Object.values) {
    Object.values = (value: object): unknown[] => {
      const object = Object(value) as Record<string, unknown>;
      const keys = Object.keys(object);
      const out: unknown[] = [];
      for (let i = 0; i < keys.length; i++) out.push(object[keys[i]!]);
      return out;
    };
  }
  if (!Object.hasOwn) {
    Object.hasOwn = (object: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(object, key);
  }
  if (!Object.getOwnPropertyDescriptors) {
    (Object as { getOwnPropertyDescriptors: (value: object) => PropertyDescriptorMap }).getOwnPropertyDescriptors = (value: object): PropertyDescriptorMap => {
      const object = Object(value);
      const out: PropertyDescriptorMap = {};
      const names = Object.getOwnPropertyNames(object);
      for (let i = 0; i < names.length; i++) {
        const desc = Object.getOwnPropertyDescriptor(object, names[i]!);
        if (desc) out[names[i]!] = desc;
      }
      if (typeof Object.getOwnPropertySymbols === "function") {
        const symbols = Object.getOwnPropertySymbols(object);
        for (let i = 0; i < symbols.length; i++) {
          const desc = Object.getOwnPropertyDescriptor(object, symbols[i]!);
          if (desc) out[symbols[i]!] = desc;
        }
      }
      return out;
    };
  }
  if (!Object.fromEntries) {
    Object.fromEntries = (entries: Iterable<readonly [PropertyKey, unknown]>): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      const list = entries as unknown as { length?: number; [index: number]: readonly [PropertyKey, unknown] | undefined };
      if (list && typeof list.length === "number") {
        for (let i = 0; i < list.length; i++) {
          const entry = list[i];
          if (entry) out[entry[0] as string] = entry[1];
        }
        return out;
      }
      const iterable = entries as unknown as { [Symbol.iterator]?: () => Iterator<readonly [PropertyKey, unknown]>; next?: () => IteratorResult<readonly [PropertyKey, unknown]> };
      let it: Iterator<readonly [PropertyKey, unknown]> | undefined;
      if (typeof Symbol !== "undefined" && iterable && typeof iterable[Symbol.iterator] === "function") it = iterable[Symbol.iterator]!();
      else if (iterable && typeof iterable.next === "function") it = iterable as Iterator<readonly [PropertyKey, unknown]>;
      if (it) {
        for (;;) {
          const step = it.next();
          if (step.done) break;
          const entry = step.value;
          if (entry) out[entry[0] as string] = entry[1];
        }
      }
      return out;
    };
  }

  const stringProto = String.prototype as unknown as {
    padStart?(maxLength: number, fillString?: string): string;
    padEnd?(maxLength: number, fillString?: string): string;
    at?(index: number): string | undefined;
    includes?(search: string, position?: number): boolean;
    startsWith?(search: string, position?: number): boolean;
    endsWith?(search: string, endPosition?: number): boolean;
    repeat?(count: number): string;
    trimStart?(): string;
    trimEnd?(): string;
    trimLeft?(): string;
    trimRight?(): string;
    replaceAll?(search: string | RegExp, replacement: string | ((substring: string, ...args: unknown[]) => string)): string;
    matchAll?(regexp: RegExp): IterableIterator<RegExpExecArray>;
  };
  if (!stringProto.padStart) stringProto.padStart = function (this: unknown, maxLength: number, fillString?: string) { return padText(this, maxLength, fillString, false); };
  if (!stringProto.padEnd) stringProto.padEnd = function (this: unknown, maxLength: number, fillString?: string) { return padText(this, maxLength, fillString, true); };
  if (!stringProto.at) {
    stringProto.at = function (this: unknown, index: number): string | undefined {
      const text = String(this);
      const i = index | 0;
      const k = i >= 0 ? i : text.length + i;
      return k < 0 || k >= text.length ? undefined : text.charAt(k);
    };
  }
  if (!stringProto.includes) {
    stringProto.includes = function (this: unknown, search: string, position?: number) {
      return String(this).indexOf(search, position === undefined ? 0 : position) !== -1;
    };
  }
  if (!stringProto.startsWith) {
    stringProto.startsWith = function (this: unknown, search: string, position?: number) {
      const text = String(this);
      const from = position === undefined ? 0 : position;
      return text.slice(from, from + search.length) === search;
    };
  }
  if (!stringProto.endsWith) {
    stringProto.endsWith = function (this: unknown, search: string, endPosition?: number) {
      const text = String(this);
      const end = endPosition === undefined ? text.length : endPosition;
      return text.slice(end - search.length, end) === search;
    };
  }
  if (!stringProto.repeat) {
    stringProto.repeat = function (this: unknown, count: number) {
      const text = String(this);
      const n = count | 0;
      if (n <= 0) return "";
      let out = "";
      for (let i = 0; i < n; i++) out += text;
      return out;
    };
  }
  if (!stringProto.trimStart) stringProto.trimStart = stringProto.trimLeft || function (this: unknown) { return String(this).replace(/^\s+/, ""); };
  if (!stringProto.trimEnd) stringProto.trimEnd = stringProto.trimRight || function (this: unknown) { return String(this).replace(/\s+$/, ""); };
  if (!stringProto.replaceAll) {
    stringProto.replaceAll = function (this: unknown, search: string | RegExp, replacement: string | ((substring: string, ...args: unknown[]) => string)): string {
      const text = String(this);
      if (Object.prototype.toString.call(search) === "[object RegExp]") return text.replace(search as RegExp, replacement as string);
      return text.split(search as string).join(replacement as string);
    };
  }
  if (!stringProto.matchAll) {
    stringProto.matchAll = function (this: unknown, regexp: RegExp): IterableIterator<RegExpExecArray> {
      const flags = (regexp.flags || "") + (regexp.global ? "" : "g");
      const copy = new RegExp(regexp.source, flags);
      const matches: RegExpExecArray[] = [];
      let match: RegExpExecArray | null;
      const text = String(this);
      while ((match = copy.exec(text))) matches.push(match);
      return matches[Symbol.iterator]();
    } as String["matchAll"];
  }

  if (typeof Number.isFinite !== "function") Number.isFinite = (value: unknown): boolean => typeof value === "number" && isFinite(value);
  if (typeof Number.isNaN !== "function") Number.isNaN = (value: unknown): boolean => typeof value === "number" && value !== value;
  if (typeof Number.isInteger !== "function") {
    Number.isInteger = (value: unknown): boolean => typeof value === "number" && isFinite(value) && Math.floor(value) === value;
  }
  if (typeof Number.isSafeInteger !== "function") {
    Number.isSafeInteger = (value: unknown): boolean => Number.isInteger(value) && Math.abs(value as number) <= 9007199254740991;
  }
  if (typeof Number.parseInt !== "function") Number.parseInt = parseInt;
  if (typeof Number.parseFloat !== "function") Number.parseFloat = parseFloat;
  if (typeof Number.EPSILON !== "number") (Number as unknown as { EPSILON: number }).EPSILON = 2.220446049250313e-16;
  if (typeof Number.MAX_SAFE_INTEGER !== "number") (Number as unknown as { MAX_SAFE_INTEGER: number }).MAX_SAFE_INTEGER = 9007199254740991;
  if (typeof Number.MIN_SAFE_INTEGER !== "number") (Number as unknown as { MIN_SAFE_INTEGER: number }).MIN_SAFE_INTEGER = -9007199254740991;

  if (typeof Math.trunc !== "function") {
    Math.trunc = (value: number): number => {
      const n = Number(value);
      return n < 0 ? Math.ceil(n) : Math.floor(n);
    };
  }
  if (typeof Math.sign !== "function") {
    Math.sign = (value: number): number => {
      const n = Number(value);
      if (n > 0) return 1;
      if (n < 0) return -1;
      return n;
    };
  }
  if (typeof Math.imul !== "function") {
    Math.imul = (a: number, b: number): number => {
      const ah = (a >>> 16) & 0xffff, al = a & 0xffff, bh = (b >>> 16) & 0xffff, bl = b & 0xffff;
      return ((al * bl + (((ah * bl + al * bh) << 16) >>> 0)) | 0);
    };
  }

  if (typeof Promise !== "undefined" && Promise.prototype && !Promise.prototype.finally) {
    Promise.prototype.finally = function (onFinally?: (() => void) | undefined | null) {
      const Ctor = this.constructor as PromiseConstructor;
      return this.then(
        value => Ctor.resolve(onFinally && onFinally()).then(() => value),
        error => Ctor.resolve(onFinally && onFinally()).then(() => { throw error; }),
      );
    };
  }
  if (typeof Promise !== "undefined" && typeof (Promise as PromiseConstructor & { allSettled?: unknown }).allSettled !== "function") {
    (Promise as PromiseConstructor & { allSettled: typeof Promise.allSettled }).allSettled = function (values: Iterable<unknown>) {
      const items: unknown[] = Array.isArray(values) ? values.slice() : Array.from(values as unknown as ArrayLike<unknown>);
      return Promise.all(items.map(item => Promise.resolve(item).then(
        value => ({ status: "fulfilled" as const, value }),
        reason => ({ status: "rejected" as const, reason }),
      )));
    };
  }

  if (root && typeof root.queueMicrotask !== "function") {
    root.queueMicrotask = (callback: () => void): void => {
      if (typeof Promise !== "undefined") Promise.resolve().then(callback);
      else setTimeout(callback, 0);
    };
  }

  if (root) {
    const typed = typedArrayCtors(root);
    for (let i = 0; i < typed.length; i++) {
      const proto = typed[i]!.prototype as { at?: (index: number) => unknown; includes?: (value: unknown, fromIndex?: number) => boolean };
      installAt(proto);
      if (!proto.includes) proto.includes = includesValue;
    }
  }

  if (typeof Element !== "undefined") {
    if (!Element.prototype.replaceChildren) {
      Element.prototype.replaceChildren = function (...nodes: (Node | string)[]): void {
        while (this.firstChild) this.removeChild(this.firstChild);
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i]!;
          this.appendChild(typeof node === "string" ? document.createTextNode(node) : node);
        }
      };
    }
    if (!Element.prototype.append) {
      Element.prototype.append = function (...nodes: (Node | string)[]): void {
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i]!;
          this.appendChild(typeof node === "string" ? document.createTextNode(node) : node);
        }
      };
    }
    if (!Element.prototype.remove) {
      Element.prototype.remove = function (): void {
        if (this.parentNode) this.parentNode.removeChild(this);
      };
    }
    if (!Element.prototype.closest) {
      Element.prototype.closest = function (selector: string): Element | null {
        let node: Element | null = this;
        while (node) {
          if (typeof node.matches === "function" && node.matches(selector)) return node;
          node = node.parentElement;
        }
        return null;
      };
    }
  }
  if (typeof NodeList !== "undefined" && !NodeList.prototype.forEach) {
    (NodeList.prototype as unknown as { forEach: typeof Array.prototype.forEach }).forEach = Array.prototype.forEach;
  }
  if (typeof Symbol !== "undefined") {
    const iterator = Array.prototype[Symbol.iterator];
    const installIterator = (proto: { [Symbol.iterator]?: () => Iterator<unknown> } | undefined): void => {
      if (proto && !proto[Symbol.iterator]) proto[Symbol.iterator] = iterator;
    };
    if (typeof NodeList !== "undefined") installIterator(NodeList.prototype);
    if (typeof HTMLCollection !== "undefined") installIterator(HTMLCollection.prototype);
    if (typeof DOMTokenList !== "undefined") installIterator(DOMTokenList.prototype);
  }
}

installKaiOSPolyfills();
