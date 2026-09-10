import { expect, it } from 'vitest';
import { sdPath } from '../../web/sd-card.ts';
it('keeps uploads inside a case-insensitive virtual directory', () => {
  expect(sdPath('Music\\Albums/', '测试.MP3')).toBe('music/albums/测试.mp3');
  expect(sdPath('', 'song.mp3')).toBe('song.mp3');
  for (const path of ['../outside','music/../../escape','c:/system','music\0']) expect(() => sdPath(path,'song.mp3')).toThrow();
});
