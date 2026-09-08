/* Firefox 48 / KaiOS 2.x — ES5 only. Loaded as a banner before any IIFE hoist. */
(function (g) {
  if (!g) return;
  if (typeof g.globalThis === "undefined") g.globalThis = g;

  function padText(value, maxLength, fill, atEnd) {
    var text = String(value);
    var width = maxLength >>> 0;
    if (width <= text.length) return text;
    var fillText = fill === undefined || fill === null ? " " : String(fill);
    if (!fillText) return text;
    var pad = "";
    var need = width - text.length;
    while (pad.length < need) pad += fillText;
    pad = pad.slice(0, need);
    return atEnd ? text + pad : pad + text;
  }

  function atIndex(index) {
    var i = index | 0;
    var k = i >= 0 ? i : this.length + i;
    return k < 0 || k >= this.length ? void 0 : this[k];
  }

  function includesValue(value, fromIndex) {
    var len = this.length >>> 0;
    var i = fromIndex === undefined ? 0 : fromIndex | 0;
    if (i < 0) i = Math.max(0, len + i);
    for (; i < len; i++) {
      var cur = this[i];
      if (cur === value || (cur !== cur && value !== value)) return true;
    }
    return false;
  }

  var A = Array.prototype;
  if (!A.at) A.at = atIndex;
  if (!A.includes) A.includes = includesValue;
  if (!A.find) {
    A.find = function (fn, thisArg) {
      for (var i = 0; i < this.length; i++) if (fn.call(thisArg, this[i], i, this)) return this[i];
    };
  }
  if (!A.findIndex) {
    A.findIndex = function (fn, thisArg) {
      for (var i = 0; i < this.length; i++) if (fn.call(thisArg, this[i], i, this)) return i;
      return -1;
    };
  }
  if (!A.fill) {
    A.fill = function (value, start, end) {
      var len = this.length >>> 0;
      var from = start === undefined ? 0 : start | 0;
      var to = end === undefined ? len : end | 0;
      if (from < 0) from = Math.max(0, len + from);
      if (to < 0) to = Math.max(0, len + to);
      for (var i = from; i < to && i < len; i++) this[i] = value;
      return this;
    };
  }
  if (!A.copyWithin) {
    A.copyWithin = function (target, start, end) {
      var len = this.length >>> 0;
      var to = target | 0, from = start | 0, last = end === undefined ? len : end | 0;
      if (to < 0) to = Math.max(0, len + to);
      if (from < 0) from = Math.max(0, len + from);
      if (last < 0) last = Math.max(0, len + last);
      var count = Math.min(last - from, len - to);
      if (count > 0) {
        var slice = this.slice(from, from + count);
        for (var i = 0; i < count; i++) this[to + i] = slice[i];
      }
      return this;
    };
  }
  if (!A.flat) {
    A.flat = function (depth) {
      var rest = depth === undefined ? 1 : depth;
      var out = [];
      var walk = function (items, n) {
        for (var i = 0; i < items.length; i++) {
          var item = items[i];
          if (n > 0 && Object.prototype.toString.call(item) === "[object Array]") walk(item, n - 1);
          else out.push(item);
        }
      };
      walk(this, rest);
      return out;
    };
  }
  if (!A.flatMap) A.flatMap = function (fn, thisArg) { return this.map(fn, thisArg).flat(); };

  if (typeof Array.from !== "function") {
    Array.from = function (items, mapFn, thisArg) {
      var list = Object(items), out = [], i = 0;
      for (; i < list.length; i++) out.push(mapFn ? mapFn.call(thisArg, list[i], i) : list[i]);
      return out;
    };
  }
  if (typeof Array.of !== "function") {
    Array.of = function () {
      var out = [], i = 0;
      for (; i < arguments.length; i++) out.push(arguments[i]);
      return out;
    };
  }

  if (!Object.assign) {
    Object.assign = function (target) {
      var dest = Object(target), i = 1;
      for (; i < arguments.length; i++) {
        var src = arguments[i];
        if (src == null) continue;
        src = Object(src);
        var keys = Object.keys(src), j = 0;
        for (; j < keys.length; j++) dest[keys[j]] = src[keys[j]];
      }
      return dest;
    };
  }
  if (!Object.entries) {
    Object.entries = function (value) {
      var object = Object(value), keys = Object.keys(object), out = [], i = 0;
      for (; i < keys.length; i++) out.push([keys[i], object[keys[i]]]);
      return out;
    };
  }
  if (!Object.values) {
    Object.values = function (value) {
      var object = Object(value), keys = Object.keys(object), out = [], i = 0;
      for (; i < keys.length; i++) out.push(object[keys[i]]);
      return out;
    };
  }
  if (!Object.hasOwn) Object.hasOwn = function (object, key) { return Object.prototype.hasOwnProperty.call(object, key); };
  if (!Object.getOwnPropertyDescriptors) {
    Object.getOwnPropertyDescriptors = function (value) {
      var object = Object(value), out = {}, names = Object.getOwnPropertyNames(object), i = 0, key, desc;
      for (; i < names.length; i++) {
        key = names[i];
        desc = Object.getOwnPropertyDescriptor(object, key);
        if (desc) out[key] = desc;
      }
      if (typeof Object.getOwnPropertySymbols === "function") {
        names = Object.getOwnPropertySymbols(object);
        for (i = 0; i < names.length; i++) {
          key = names[i];
          desc = Object.getOwnPropertyDescriptor(object, key);
          if (desc) out[key] = desc;
        }
      }
      return out;
    };
  }
  if (!Object.fromEntries) {
    Object.fromEntries = function (entries) {
      var out = {}, i = 0, entry, it, step;
      if (!entries) return out;
      if (typeof entries.length === "number") {
        for (; i < entries.length; i++) {
          entry = entries[i];
          if (entry) out[entry[0]] = entry[1];
        }
        return out;
      }
      if (typeof Symbol !== "undefined" && entries[Symbol.iterator]) it = entries[Symbol.iterator]();
      else if (typeof entries.next === "function") it = entries;
      if (it) {
        for (;;) {
          step = it.next();
          if (step.done) break;
          entry = step.value;
          if (entry) out[entry[0]] = entry[1];
        }
      }
      return out;
    };
  }

  var S = String.prototype;
  if (!S.padStart) S.padStart = function (n, fill) { return padText(this, n, fill, false); };
  if (!S.padEnd) S.padEnd = function (n, fill) { return padText(this, n, fill, true); };
  if (!S.at) {
    S.at = function (index) {
      var text = String(this);
      var i = index | 0;
      var k = i >= 0 ? i : text.length + i;
      return k < 0 || k >= text.length ? void 0 : text.charAt(k);
    };
  }
  if (!S.includes) S.includes = function (search, position) { return String(this).indexOf(search, position === undefined ? 0 : position) !== -1; };
  if (!S.startsWith) {
    S.startsWith = function (search, position) {
      var text = String(this);
      var from = position === undefined ? 0 : position;
      return text.slice(from, from + search.length) === search;
    };
  }
  if (!S.endsWith) {
    S.endsWith = function (search, endPosition) {
      var text = String(this);
      var end = endPosition === undefined ? text.length : endPosition;
      return text.slice(end - search.length, end) === search;
    };
  }
  if (!S.repeat) {
    S.repeat = function (count) {
      var text = String(this), n = count | 0, out = "", i = 0;
      if (n <= 0) return "";
      for (; i < n; i++) out += text;
      return out;
    };
  }
  if (!S.trimStart) S.trimStart = S.trimLeft || function () { return String(this).replace(/^\s+/, ""); };
  if (!S.trimEnd) S.trimEnd = S.trimRight || function () { return String(this).replace(/\s+$/, ""); };
  if (!S.replaceAll) {
    S.replaceAll = function (search, replacement) {
      var text = String(this);
      if (Object.prototype.toString.call(search) === "[object RegExp]") return text.replace(search, replacement);
      return text.split(search).join(replacement);
    };
  }
  if (!S.matchAll) {
    S.matchAll = function (regexp) {
      var flags = (regexp.flags || "") + (regexp.global ? "" : "g");
      var copy = new RegExp(regexp.source, flags);
      var matches = [], match, text = String(this);
      while ((match = copy.exec(text))) matches.push(match);
      return matches;
    };
  }

  if (typeof Number.isFinite !== "function") Number.isFinite = function (value) { return typeof value === "number" && isFinite(value); };
  if (typeof Number.isNaN !== "function") Number.isNaN = function (value) { return typeof value === "number" && value !== value; };
  if (typeof Number.isInteger !== "function") Number.isInteger = function (value) { return typeof value === "number" && isFinite(value) && Math.floor(value) === value; };
  if (typeof Number.isSafeInteger !== "function") Number.isSafeInteger = function (value) { return Number.isInteger(value) && Math.abs(value) <= 9007199254740991; };
  if (typeof Number.parseInt !== "function") Number.parseInt = parseInt;
  if (typeof Number.parseFloat !== "function") Number.parseFloat = parseFloat;
  if (typeof Number.EPSILON !== "number") Number.EPSILON = 2.220446049250313e-16;
  if (typeof Number.MAX_SAFE_INTEGER !== "number") Number.MAX_SAFE_INTEGER = 9007199254740991;
  if (typeof Number.MIN_SAFE_INTEGER !== "number") Number.MIN_SAFE_INTEGER = -9007199254740991;

  if (typeof Math.trunc !== "function") Math.trunc = function (value) { var n = Number(value); return n < 0 ? Math.ceil(n) : Math.floor(n); };
  if (typeof Math.sign !== "function") Math.sign = function (value) { var n = Number(value); return n > 0 ? 1 : n < 0 ? -1 : n; };
  if (typeof Math.imul !== "function") {
    Math.imul = function (a, b) {
      var ah = (a >>> 16) & 65535, al = a & 65535, bh = (b >>> 16) & 65535, bl = b & 65535;
      return al * bl + (((ah * bl + al * bh) << 16) >>> 0) | 0;
    };
  }

  if (typeof Promise !== "undefined" && Promise.prototype && !Promise.prototype.finally) {
    Promise.prototype.finally = function (cb) {
      var Ctor = this.constructor;
      return this.then(
        function (value) { return Ctor.resolve(typeof cb === "function" ? cb() : void 0).then(function () { return value; }); },
        function (error) { return Ctor.resolve(typeof cb === "function" ? cb() : void 0).then(function () { throw error; }); }
      );
    };
  }
  if (typeof Promise !== "undefined" && typeof Promise.allSettled !== "function") {
    Promise.allSettled = function (values) {
      var items = [], i = 0;
      if (values && typeof values.length === "number") {
        for (; i < values.length; i++) items.push(values[i]);
      }
      return Promise.all(items.map(function (item) {
        return Promise.resolve(item).then(
          function (value) { return { status: "fulfilled", value: value }; },
          function (reason) { return { status: "rejected", reason: reason }; }
        );
      }));
    };
  }

  if (typeof g.queueMicrotask !== "function") {
    g.queueMicrotask = function (cb) {
      if (typeof Promise !== "undefined") Promise.resolve().then(cb);
      else setTimeout(cb, 0);
    };
  }

  var typedNames = ["Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array", "Uint32Array", "Float32Array", "Float64Array"];
  for (var t = 0; t < typedNames.length; t++) {
    var Typed = g[typedNames[t]];
    if (!Typed || !Typed.prototype) continue;
    if (!Typed.prototype.at) Typed.prototype.at = atIndex;
    if (!Typed.prototype.includes) Typed.prototype.includes = includesValue;
  }

  if (typeof Element !== "undefined") {
    if (!Element.prototype.replaceChildren) {
      Element.prototype.replaceChildren = function () {
        while (this.firstChild) this.removeChild(this.firstChild);
        for (var i = 0; i < arguments.length; i++) {
          var node = arguments[i];
          this.appendChild(typeof node === "string" ? document.createTextNode(node) : node);
        }
      };
    }
    if (!Element.prototype.append) {
      Element.prototype.append = function () {
        for (var i = 0; i < arguments.length; i++) {
          var node = arguments[i];
          this.appendChild(typeof node === "string" ? document.createTextNode(node) : node);
        }
      };
    }
    if (!Element.prototype.remove) {
      Element.prototype.remove = function () {
        if (this.parentNode) this.parentNode.removeChild(this);
      };
    }
    if (!Element.prototype.closest) {
      Element.prototype.closest = function (selector) {
        var node = this;
        while (node) {
          if (typeof node.matches === "function" && node.matches(selector)) return node;
          node = node.parentElement;
        }
        return null;
      };
    }
  }
  if (typeof NodeList !== "undefined" && !NodeList.prototype.forEach) NodeList.prototype.forEach = A.forEach;
  if (typeof Symbol !== "undefined") {
    var iterator = A[Symbol.iterator];
    if (iterator) {
      if (typeof NodeList !== "undefined" && !NodeList.prototype[Symbol.iterator]) NodeList.prototype[Symbol.iterator] = iterator;
      if (typeof HTMLCollection !== "undefined" && !HTMLCollection.prototype[Symbol.iterator]) HTMLCollection.prototype[Symbol.iterator] = iterator;
      if (typeof DOMTokenList !== "undefined" && !DOMTokenList.prototype[Symbol.iterator]) DOMTokenList.prototype[Symbol.iterator] = iterator;
    }
  }
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : this);
