import { expect, it } from 'vitest';
import { ExtRuntime } from '../../src/abi/runtime.ts';
import { formatU64, smul64, umul64 } from '../../src/abi/u64.ts';
import { guestPrintf, guestSprintf, aapcsPrintfVararg, aapcsSprintfVararg } from '../../src/mythroad/sprintf.ts';

it('multiplies and formats 64-bit values without BigInt', () => {
  expect(umul64(0xffffffff, 0xffffffff)).toEqual([1, 0xfffffffe]);
  expect(smul64(-1, -1)).toEqual([1, 0]);
  expect(smul64(-2, 3)).toEqual([(0xfffffffa) >>> 0, 0xffffffff]);
  expect(formatU64(0x80000000, 0, 'd')).toBe('-9223372036854775808');
  expect(formatU64(0xffffffff, 0xffffffff, 'u')).toBe('18446744073709551615');
});

function fixture() {
  const ext = new ExtRuntime(), dst = ext.alloc(512);
  const str = (value: string) => { const p = ext.alloc(value.length + 1); ext.mem.load(p, new TextEncoder().encode(value + '\0')); return p; };
  return { ext, dst, str };
}
it('formats signed and unsigned 64-bit values without losing precision', () => {
  const { ext, dst, str } = fixture();
  const words = [0, 0x80000000, 0xffffffff, 0xffffffff, 0x89abcdef, 0x12345678];
  const len = guestSprintf(ext.mem, dst, str('%lld %llu %llX'), i => words[i]);
  expect(new TextDecoder().decode(ext.mem.slice(dst, len))).toBe('-9223372036854775808 18446744073709551615 1234567889ABCDEF');
  expect(ext.mem.read8(dst + len)).toBe(0);
});
it('aligns a long long after an int to the next even AAPCS word', () => {
  const { ext, dst, str } = fixture();
  const args = new Uint32Array([dst, 0, 7, 0xdeadbeef, 0xffffffd6, 0xffffffff, 9, 0]);
  const indices: number[] = [];
  const len = guestSprintf(ext.mem, dst, str('%d %08lld %u'), i => { indices.push(i); return aapcsSprintfVararg(args, i); });
  expect(new TextDecoder().decode(ext.mem.slice(dst, len))).toBe('7 -0000042 9');
  expect(indices).toEqual([0, 2, 3, 4]);
});
it('skips R1 padding for printf and reads subsequent long longs from aligned stack pairs', () => {
  const { ext, str } = fixture();
  const args = new Uint32Array([0, 0xdeadbeef, 5, 1, 0xffffffff, 0xffffffff, 8, 0]);
  expect(guestPrintf(ext.mem, str('%lld %lld %u'), i => aapcsPrintfVararg(args, i))).toBe('4294967301 -1 8');
});
