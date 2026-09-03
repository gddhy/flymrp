/** Device / system info. Lua never reads DOM/window. */

export type DeviceProfile = {
  width: number;
  height: number;
  /** FULL mythroad.c */
  vmver: number;
  hsman: string;
  hstype: string;
  IMEI: string;
  IMSI: string;
  hsver: number;
  /** gb16 MEDIUM: U+70B9 */
  chw: number;
  chh: number;
  /** gb16 MEDIUM: U+0032 */
  ascw: number;
  asch: number;
  datetime: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  };
  randSeed: number;
  memMin: number;
  memTop: number;
  memLeft: number;
};

export function defaultProfile(over: Partial<DeviceProfile> = {}): DeviceProfile {
  const { datetime, ...rest } = over;
  return {
    width: 240,
    height: 320,
    vmver: 1968,
    hsman: "flymrp",
    hstype: "stage5b",
    IMEI: "0000000000000000",
    IMSI: "0000000000000000",
    hsver: 1,
    chw: 16,
    chh: 16,
    ascw: 8,
    asch: 16,
    datetime: { year: 2026, month: 9, day: 3, hour: 16, minute: 0, second: 0, ...datetime },
    randSeed: 1,
    memMin: 0,
    memTop: 1024 * 1024,
    memLeft: 512 * 1024,
    ...rest,
  };
}

export function lcgNext(seed: number): number {
  return (Math.imul(seed, 1103515245) + 12345) >>> 0;
}
