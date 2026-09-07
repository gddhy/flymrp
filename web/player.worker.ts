import { MythroadRuntime, loadGb16Uc2, type GraphicsBackend } from '../src/mythroad/index.ts';
import { DEFAULT_NETWORK_RULES } from '../src/mythroad/network-rules.ts';
import { binToBytes } from '../src/mrp/index.ts';
import { EV_KEY } from '../src/mythroad/events.ts';
import { clockSlices } from './player-options.ts';
import type { PlayerRequest, PlayerResponse } from './player-protocol.ts';

const send = (message: PlayerResponse, transfer: Transferable[] = []) => postMessage(message, { transfer });
let rt: MythroadRuntime | null = null;
let pending: Extract<PlayerResponse, { type: 'frame' }> | null = null;
let nextPresent = 0, remainder = 0;
function present(): void {
  if (!pending) return;
  const frame = pending; pending = null;
  send(frame, [frame.pixels.buffer as ArrayBuffer]);
  nextPresent = performance.now() + 16;
}
class Display implements GraphicsBackend {
  clear() {} drawRect() {} drawLine() {} drawPoint() {} drawText() {}
  effSetCon() {} image() {} sprite() {} tile() {}
  flush(): void {
    if (!rt) return;
    const screen = rt.screen;
    if (!pending || pending.width !== screen.width || pending.height !== screen.height) {
      pending = { type: 'frame', width: screen.width, height: screen.height, pixels: new Uint16Array(screen.pixels.length) };
    }
    // Retain the last LCD flush, even if guest code clears its working buffer.
    pending.pixels.set(screen.pixels);
    // A benchmark can flush 100,000 times. Bound UI messages, not guest work.
    if (performance.now() >= nextPresent) present();
  }
}
function step(milliseconds: number): void {
  remainder += milliseconds;
  const whole = Math.floor(remainder); remainder -= whole;
  rt!.advance(whole);
  for (let i = 0; i < 16 && rt!.step(); i++);
  if (rt!.exited) throw new Error('游戏已退出');
}
onmessage = (event: MessageEvent<PlayerRequest>) => {
  const message = event.data;
  try {
    if (message.type === 'start') {
      loadGb16Uc2(message.files['system/gb16.uc2']);
      rt = new MythroadRuntime({ profile: message.profile, systemFiles: message.files, graphics: new Display(), abiMode: 'strict',
        networkRules: DEFAULT_NETWORK_RULES,
        onEditChange: state => send({ type: 'edit', state }),
        onPlaySound: (format, bytes, loop) => send({ type: 'sound', format, bytes, loop }),
        onStopSound: format => send({ type: 'sound-stop', format }),
      });
      const archive = rt.loadMrp(new Uint8Array(message.bytes));
      rt.start();
      for (let i = 0; i < 32; i++) step(80);
      present();
      send({ type: 'ready', title: new TextDecoder('gbk').decode(binToBytes(archive.header.appname)) });
      return;
    }
    if (!rt) return;
    switch (message.type) {
      case 'tick': for (const elapsed of clockSlices(message.milliseconds, message.speed)) step(elapsed); present(); send({ type: 'tick-complete' }); break;
      case 'key': if (message.pressed) rt.input.press(message.key); else rt.input.release(message.key); break;
      case 'touch': rt.queueEvent(EV_KEY, message.event, message.x, message.y); break;
      case 'pause': if (message.paused) rt.pause(); else rt.resume(); present(); break;
      case 'edit': rt.mrTable?.editor.finish(message.text, message.accepted); break;
    }
  } catch (error) {
    present();
    send({ type: 'error', message: error instanceof Error ? error.message : String(error), exited: rt?.exited ?? false });
    rt = null;
  }
};
