/** Filename hints override collection-directory hints; otherwise use the common 240×320 handset. */
export function inferScreenSize(name: string): { width: number; height: number } {
  const sizes = [...name.matchAll(/(128|160|176|220|240|320|400|480)[×xX*](128|160|176|220|240|320|400|480)/g)];
  const size = sizes.at(-1);
  return size ? { width: Number(size[1]), height: Number(size[2]) } : { width: 240, height: 320 };
}
