import {
  MR_KEY_BACK,
  MR_KEY_DOWN,
  MR_KEY_FIRE,
  MR_KEY_LEFT,
  MR_KEY_PRESS,
  MR_KEY_RELEASE,
  MR_KEY_RIGHT,
  MR_KEY_UP,
} from "./constants.ts";
import { EventError } from "../err/errors.ts";
import { EV_KEY, EventQueue } from "./events.ts";

const ALIAS: Record<string, number> = {
  UP: MR_KEY_UP,
  DOWN: MR_KEY_DOWN,
  LEFT: MR_KEY_LEFT,
  RIGHT: MR_KEY_RIGHT,
  FIRE: MR_KEY_FIRE,
  BACK: MR_KEY_BACK,
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
