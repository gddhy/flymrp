/** Gecko 48: `yield` in calls/comma/ternary must be parenthesized. */

function isIdent(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_$]/.test(ch);
}

function skipSpace(source: string, index: number): number {
  while (index < source.length && /[\s\u2028\u2029]/.test(source[index]!)) index++;
  return index;
}

function skipLineComment(source: string, index: number): number {
  const end = source.indexOf("\n", index);
  return end < 0 ? source.length : end + 1;
}

function skipBlockComment(source: string, index: number): number {
  const end = source.indexOf("*/", index + 2);
  return end < 0 ? source.length : end + 2;
}

function skipQuoted(source: string, index: number): number {
  const quote = source[index]!;
  for (let i = index + 1; i < source.length; i++) {
    if (source[i] === "\\") { i++; continue; }
    if (source[i] === quote) return i + 1;
  }
  return source.length;
}

function skipTemplate(source: string, index: number): number {
  for (let i = index + 1; i < source.length; i++) {
    if (source[i] === "\\") { i++; continue; }
    if (source[i] === "`") return i + 1;
    if (source[i] === "$" && source[i + 1] === "{") {
      i = skipNested(source, i + 2, "}");
      i--;
    }
  }
  return source.length;
}

function regexOpener(source: string, index: number): boolean {
  let i = index - 1;
  while (i >= 0 && /[\s\u2028\u2029]/.test(source[i]!)) i--;
  if (i < 0) return true;
  const prev = source[i]!;
  if (/[)\]}\w$]/.test(prev)) return false;
  return true;
}

function skipRegex(source: string, index: number): number {
  for (let i = index + 1; i < source.length; i++) {
    if (source[i] === "\\") { i++; continue; }
    if (source[i] === "[") {
      i++;
      while (i < source.length && source[i] !== "]") {
        if (source[i] === "\\") i++;
        i++;
      }
      continue;
    }
    if (source[i] === "/") {
      i++;
      while (i < source.length && /[a-z]/i.test(source[i]!)) i++;
      return i;
    }
  }
  return source.length;
}

function skipLiteral(source: string, index: number): number | null {
  const ch = source[index];
  if (ch === "'" || ch === '"') return skipQuoted(source, index);
  if (ch === "`") return skipTemplate(source, index);
  if (ch === "/" && source[index + 1] === "/") return skipLineComment(source, index);
  if (ch === "/" && source[index + 1] === "*") return skipBlockComment(source, index);
  if (ch === "/" && regexOpener(source, index)) return skipRegex(source, index);
  return null;
}

function skipNested(source: string, index: number, closer: string): number {
  let depth = 0;
  for (let i = index; i < source.length; i++) {
    const lit = skipLiteral(source, i);
    if (lit !== null) { i = lit - 1; continue; }
    const ch = source[i]!;
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0 && ch === closer) return i + 1;
      if (depth === 0) return i;
      depth--;
    }
  }
  return source.length;
}

function endOfYieldOperand(source: string, index: number): number {
  let depth = 0;
  let ternary = 0;
  for (let i = index; i < source.length; i++) {
    const lit = skipLiteral(source, i);
    if (lit !== null) { i = lit - 1; continue; }
    const ch = source[i]!;
    if (ch === "(" || ch === "[" || ch === "{") { depth++; continue; }
    if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) return i;
      depth--;
      continue;
    }
    if (depth !== 0) continue;
    if (ch === "," || ch === ";") return i;
    if (ch === "?") { ternary++; continue; }
    if (ch === ":") {
      if (ternary === 0) return i;
      ternary--;
    }
  }
  return source.length;
}

export function parenthesizeYields(source: string): string {
  let out = "";
  for (let i = 0; i < source.length; ) {
    const lit = skipLiteral(source, i);
    if (lit !== null) {
      out += source.slice(i, lit);
      i = lit;
      continue;
    }
    if (
      source.startsWith("yield", i) &&
      !isIdent(source[i - 1]) &&
      !isIdent(source[i + 5]) &&
      source[i - 1] !== "."
    ) {
      const after = skipSpace(source, i + 5);
      if (source[after] !== ":") {
        const starred = source[after] === "*";
        const operand = skipSpace(source, starred ? after + 1 : after);
        const end = endOfYieldOperand(source, operand);
        const head = starred ? "yield*" : "yield";
        const raw = source.slice(i, end);
        out += `(${head}${parenthesizeYields(raw.slice(head.length))})`;
        i = end;
        continue;
      }
    }
    out += source[i];
    i++;
  }
  return out;
}
