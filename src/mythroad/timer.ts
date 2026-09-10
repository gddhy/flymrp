import { TimerError } from "../err/errors.ts";
import {
  MR_STATE_PAUSE,
  MR_STATE_RUN,
  MR_TIMER_STATE_IDLE,
  MR_TIMER_STATE_RUNNING,
  MR_TIMER_STATE_SUSPENDED,
} from "./constants.ts";

/**
 * Single platform timer (rxgj). One-shot: fire → IDLE.
 * Repeat is Lua/EXT calling TimerStart again.
 */
export class MythroadTimer {
  state = MR_TIMER_STATE_IDLE;
  callback = "dealtimer";
  interval = 0;
  deadline = 0;
  runWithoutPause = 0;
  starts = 0;
  stops = 0;
  fires = 0;

  start(now: number, interval: number, callback: string, mrState: number): boolean {
    if (!this.allowed(mrState)) return false;
    if (interval < 0 || interval > 0xffff) throw new TimerError(`timer interval out of uint16: ${interval}`);
    this.interval = interval & 0xffff;
    this.callback = callback;
    this.deadline = now + this.interval;
    this.state = MR_TIMER_STATE_RUNNING;
    this.starts++;
    return true;
  }

  stop(): void {
    this.state = MR_TIMER_STATE_IDLE;
    this.stops++;
  }

  suspend(): void {
    if (this.state === MR_TIMER_STATE_RUNNING) this.state = MR_TIMER_STATE_SUSPENDED;
  }

  resume(now: number): void {
    if (this.state === MR_TIMER_STATE_SUSPENDED) {
      this.deadline = now + 300;
      this.state = MR_TIMER_STATE_RUNNING;
    }
  }

  /** If due, go IDLE and return the callback name. Caller queues TIMER. */
  due(now: number): string | null {
    if (this.state !== MR_TIMER_STATE_RUNNING) return null;
    if (now < this.deadline) return null;
    this.state = MR_TIMER_STATE_IDLE;
    this.fires++;
    return this.callback;
  }

  allowed(mrState: number): boolean {
    return mrState === MR_STATE_RUN || (this.runWithoutPause !== 0 && mrState === MR_STATE_PAUSE);
  }
}
