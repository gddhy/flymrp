import {
  MR_KEY_BACK,
  MR_KEY_DOWN,
  MR_KEY_FIRE,
  MR_KEY_LEFT,
  MR_KEY_PRESS,
  MR_KEY_RELEASE,
  MR_KEY_RIGHT,
  MR_KEY_SOFTLEFT,
  MR_KEY_SOFTRIGHT,
  MR_KEY_UP,
} from "./constants.ts";
import { EventError } from "../err/errors.ts";
import { EV_KEY, EventQueue } from "./events.ts";

const ALIAS: Record<string, number> = {
  0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9,
  STAR: 10,
  POUND: 11,
  "*": 10,
  "#": 11,
  UP: MR_KEY_UP,
  DOWN: MR_KEY_DOWN,
  LEFT: MR_KEY_LEFT,
  RIGHT: MR_KEY_RIGHT,
  FIRE: MR_KEY_FIRE,
  BACK: MR_KEY_BACK,
  SOFTLEFT: MR_KEY_SOFTLEFT,
  SOFTRIGHT: MR_KEY_SOFTRIGHT,
};

export class InputBackend {
  constructor(private readonly q: EventQueue) {}

  press(key: string | number): void {
    this.q.queue(EV_KEY, MR_KEY_PRESS, resolveKey(key), 0);
  }

  release(key: string | number): void {
    this.q.queue(EV_KEY, MR_KEY_RELEASE, resolveKey(key), 0);
  }
}

export function resolveKey(key: string | number): number {
  if (typeof key === "number") return key | 0;
  const hit = ALIAS[key.toUpperCase()];
  if (hit === undefined) throw new EventError(`unknown synthetic key ${key}`);
  return hit;
}
