/** rxgj `mr.h` / `mrporting.h` — confirmed numeric ABI. */

export const MR_SUCCESS = 0;
export const MR_FAILED = -1;
export const MR_IGNORE = 1;

export const MR_VERSION = 1968; // FULL mythroad.c, not mini 2011

export const MR_STATE_IDLE = 0;
export const MR_STATE_RUN = 1;
export const MR_STATE_PAUSE = 2;
export const MR_STATE_RESTART = 3;
export const MR_STATE_STOP = 4;
export const MR_STATE_ERROR = 5;

export const MR_TIMER_STATE_IDLE = 0;
export const MR_TIMER_STATE_RUNNING = 1;
export const MR_TIMER_STATE_SUSPENDED = 2;
export const MR_TIMER_STATE_ERROR = 3;

export const MR_FILE_RDONLY = 1;
export const MR_FILE_WRONLY = 2;
export const MR_FILE_RDWR = 4;
export const MR_FILE_CREATE = 8;
export const MR_FILE_RECREATE = 16;

export const MR_SEEK_SET = 0;
export const MR_SEEK_CUR = 1;
export const MR_SEEK_END = 2;

export const MR_IS_FILE = 1;
export const MR_IS_DIR = 2;
export const MR_IS_INVALID = 8;
export const MR_FILE_STATE_NIL = 0;
export const MR_FILE_STATE_OPEN = 1;
export const MR_FILE_STATE_CLOSED = 2;

export const MR_FONT_SMALL = 0;
export const MR_FONT_MEDIUM = 1;
export const MR_FONT_BIG = 2;

/** rxgj `mrporting.h`. Language / plat query return base. */
export const MR_PLAT_VALUE_BASE = 1000;
export const MR_CHINESE = MR_PLAT_VALUE_BASE;
/** `mr_plat` code: get handset language. */
export const MR_GET_HANDSET_LG = 1206;

export const MR_FLAGS_BI = 1;
export const MR_FLAGS_AI = 2;
export const MR_FLAGS_RI = 4;
export const MR_FLAGS_EI = 8;

export const MR_KEY_PRESS = 0;
export const MR_KEY_RELEASE = 1;
export const MR_MOUSE_DOWN = 2;
export const MR_MOUSE_UP = 3;
export const MR_MENU_SELECT = 4;
export const MR_MENU_RETURN = 5;
export const MR_DIALOG_EVENT = 6;
export const MR_SMS_INDICATION = 7;
export const MR_EXIT_EVENT = 8;
export const MR_SMS_RESULT = 9;
export const MR_LOCALUI_EVENT = 10;
export const MR_OSD_EVENT = 11;
export const MR_MOUSE_MOVE = 12;
export const MR_ERROR_EVENT = 13;

export const MR_KEY_0 = 0;
export const MR_KEY_1 = 1;
export const MR_KEY_2 = 2;
export const MR_KEY_3 = 3;
export const MR_KEY_4 = 4;
export const MR_KEY_5 = 5;
export const MR_KEY_6 = 6;
export const MR_KEY_7 = 7;
export const MR_KEY_8 = 8;
export const MR_KEY_9 = 9;
export const MR_KEY_STAR = 10;
export const MR_KEY_POUND = 11;
export const MR_KEY_UP = 12;
export const MR_KEY_DOWN = 13;
export const MR_KEY_LEFT = 14;
export const MR_KEY_RIGHT = 15;
export const MR_KEY_POWER = 16;
export const MR_KEY_SOFTLEFT = 17;
export const MR_KEY_SOFTRIGHT = 18;
export const MR_KEY_SEND = 19;
export const MR_KEY_SELECT = 20;
export const MR_KEY_VOLUME_UP = 21;
export const MR_KEY_VOLUME_DOWN = 22;
export const MR_KEY_CLEAR = 23;
export const MR_KEY_A = 24;
export const MR_KEY_B = 25;
export const MR_KEY_CAPTURE = 26;
export const MR_KEY_NONE = 27;

/** Fixture aliases — enum values confirmed; names are test conveniences. */
export const MR_KEY_FIRE = MR_KEY_SELECT;
export const MR_KEY_BACK = MR_KEY_SOFTRIGHT;

export const SHORT_TYPENAMES = ["nil", "bool", "obj", "num", "str", "tab", "func", "obj", "co"] as const;
export const TYPENAMES = ["nil", "boolean", "object", "number", "string", "table", "function", "object", "thread"] as const;

export const BITMAPMAX = 30;
export const SPRITEMAX = 10;
export const TILEMAX = 3;
export const BM_COPY = 0;
export const BM_TRANSPARENT = 1;
export const MR_START_FILE = "start.mr";

export type RuntimeAction =
  | { kind: "RUN_FILE"; pack: string; file: string; param: string }
  | { kind: "RESTART" }
  | { kind: "EXIT" };
