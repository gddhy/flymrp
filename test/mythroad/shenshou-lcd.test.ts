import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { crc32 } from "../../src/mrp/gzip.ts";
import { loadGb16Uc2, MythroadRuntime } from "../../src/mythroad/index.ts";
import { SYSTEM_COMPONENTS } from "../../src/mythroad/system-components.ts";
import { FrameCapture } from "../../tools/real/frame-capture.ts";

const gameDir = process.env.MRP_GAME_DIR;
if (!gameDir) throw new Error("此测试需要 MRP_GAME_DIR 环境变量指向游戏目录。");
const GAME = join(gameDir, "mrpoid2在线商城所有游戏/神兽传说.mrp");
const ROOT = resolve(import.meta.dirname, "../..");

function png(width: number, height: number, pixels: Uint16Array): Buffer {
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const c = pixels[y * width + x]!, off = y * (width * 3 + 1) + 1 + x * 3;
    rows[off] = Math.round(((c >>> 11) & 31) * 255 / 31);
    rows[off + 1] = Math.round(((c >>> 5) & 63) * 255 / 63);
    rows[off + 2] = Math.round((c & 31) * 255 / 31);
  }
  const chunk = (type: string, data: Buffer) => {
    const name = Buffer.from(type), head = Buffer.alloc(4), crc = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([head, name, data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function samePixels(a: Uint16Array, b: Uint16Array): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === b[i]) n++;
  return n;
}

describe("神兽传说 LCD dirty present", () => {
  it.skipIf(!existsSync(GAME))("keeps HUD chrome after 240x256 playfield flushes", () => {
    const systemFiles = Object.fromEntries(
      SYSTEM_COMPONENTS.map(name => [name, readFileSync(join(ROOT, "assets", name))]),
    );
    loadGb16Uc2(systemFiles["system/gb16.uc2"]!);
    let rt: MythroadRuntime;
    const display = new FrameCapture(() => rt.screen, 240, 320);
    rt = new MythroadRuntime({
      profile: { width: 240, height: 320 },
      abiMode: "strict",
      systemFiles,
      graphics: display,
    });
    const tick = (n: number) => {
      for (let i = 0; i < n; i++) {
        rt.advance(80);
        for (let k = 0; k < 16 && rt.step(); k++);
        if (rt.exited) throw new Error("guest exited");
      }
    };
    const press = (key: string) => {
      rt.input.press(key);
      tick(3);
      rt.input.release(key);
      tick(8);
    };
    rt.loadMrp(new Uint8Array(readFileSync(GAME)));
    rt.start();
    tick(40);
    for (let i = 0; i < 8; i++) press("FIRE");
    tick(4);
    const w = 240;
    const workHud = rt.screen.pixels.subarray(256 * w, 272 * w);
    const lcdHud = display.pixels.subarray(256 * w, 272 * w);
    expect(samePixels(lcdHud, workHud)).toBeLessThan(w * 16 * 0.5);
    const out = join(ROOT, "artifacts/shenshou-fix");
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "after.png"), png(w, 320, display.pixels));
    writeFileSync(join(out, "working.png"), png(w, 320, rt.screen.pixels));
  });
});
