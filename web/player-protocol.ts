import type { DeviceProfile } from '../src/mythroad/profile.ts';
import type { EditState } from '../src/mythroad/native-editor.ts';
import type { PlayerFileSource } from './remote-files.ts';

export type { PlayerFileSource };

export type PlayerRequest =
  | { type: 'start'; bytes: ArrayBuffer; profile: Partial<DeviceProfile>; files: Record<string, Uint8Array>; resources?: Record<string, Uint8Array>; userFiles?: Record<string, Uint8Array>; fileSource?: PlayerFileSource }
  | { type: 'sd-file'; path: string; bytes: Uint8Array | null }
  | { type: 'tick'; milliseconds: number; speed: number }
  | { type: 'key'; key: string; pressed: boolean }
  | { type: 'touch'; event: number; x: number; y: number }
  | { type: 'pause'; paused: boolean }
  | { type: 'edit'; text: string; accepted: boolean };
export type PlayerResponse =
  | { type: 'frame'; width: number; height: number; pixels: Uint16Array }
  | { type: 'ready'; title: string }
  | { type: 'tick-complete' }
  | { type: 'edit'; state: EditState | null }
  | { type: 'sound'; format: number; bytes: Uint8Array | null; loop: number; positionMs?: number }
  | { type: 'sound-stop'; format: number }
  | { type: 'vibrate'; milliseconds: number }
  | { type: 'error'; message: string; exited: boolean };
