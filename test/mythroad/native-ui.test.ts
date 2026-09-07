import { expect, it } from 'vitest';
import { ExtRuntime } from '../../src/abi/runtime.ts';
import { NativeUi } from '../../src/mythroad/native-ui.ts';
import { ScreenBuffer } from '../../src/mythroad/graphics.ts';
import { MR_DIALOG_EVENT, MR_KEY_DOWN, MR_KEY_FIRE, MR_KEY_SOFTRIGHT, MR_MENU_SELECT, MR_MOUSE_DOWN, MR_MOUSE_UP } from '../../src/mythroad/constants.ts';

function setup() {
  const ext = new ExtRuntime(), events: number[][] = [];
  const ui = new NativeUi(ext.mem, () => {}, (type, value) => events.push([type, value]));
  const str = (value: string) => {
    const address = ext.alloc((value.length + 1) * 2);
    [...value].forEach((ch, i) => { ext.mem.write8(address + i * 2, ch.charCodeAt(0) >>> 8); ext.mem.write8(address + i * 2 + 1, ch.charCodeAt(0)); });
    ext.mem.write16(address + value.length * 2, 0); return address;
  };
  return { ui, events, str };
}

it('renders an independent menu overlay and delivers one selection without leaking key-up', () => {
  const { ui, events, str } = setup(), screen = new ScreenBuffer(240, 320);
  screen.pixels.fill(0x1234);
  const handle = ui.create('menu', str('游戏'));
  ui.setItem(handle, str('开始'), 0); ui.setItem(handle, str('信息'), 1);
  expect(ui.active).toBeNull();
  ui.show(handle);
  expect(ui.render(screen).pixels[0]).not.toBe(0x1234);
  expect(screen.pixels.every(pixel => pixel === 0x1234)).toBe(true);
  ui.key(0, MR_KEY_DOWN); ui.key(1, MR_KEY_DOWN);
  expect(ui.active?.selected).toBe(1);
  expect(ui.key(0, MR_KEY_FIRE)).toBe(true);
  expect(ui.key(1, MR_KEY_FIRE)).toBe(true);
  expect(events).toEqual([[MR_MENU_SELECT, 1]]);
  expect(ui.render(screen)).toBe(screen);
  expect(ui.key(0, MR_KEY_DOWN)).toBe(false);
});

it('keeps handles independent and respects dialog buttons for keys and touches', () => {
  const { ui, events, str } = setup();
  const first = ui.create('text', str('信息'), str('详情'), 0);
  const second = ui.create('dialog', str('返回'), str('取消'), 2);
  ui.release(first); expect(ui.active?.handle).toBe(second);
  ui.key(0, MR_KEY_FIRE); ui.key(1, MR_KEY_FIRE);
  expect(events).toEqual([]);
  ui.render(new ScreenBuffer(320, 240));
  ui.key(MR_MOUSE_DOWN, 300, 230);
  expect(events).toEqual([[MR_DIALOG_EVENT, 1]]);
  expect(ui.key(MR_MOUSE_UP, 300, 230)).toBe(true);
  const noButtons = ui.create('dialog', str('等待'), 0, 100);
  ui.key(0, MR_KEY_SOFTRIGHT); ui.key(0, MR_KEY_FIRE);
  expect(events).toHaveLength(1);
  ui.release(noButtons); expect(ui.active).toBeNull();
});
