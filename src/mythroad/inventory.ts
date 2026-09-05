/** A/B counts are frozen (docs/stage5b-api-inventory.md). C is Stage 5-C only. */

export const IMPLEMENTED_A = [
  "_strCom/601",
  "_strCom/800",
  "_strCom/801",
  "_strCom/802",
  "_com/1",
  "_com/400",
  "_com/403",
  "_com/3629",
  "GetSysInfo",
  "TimerStart",
  "TimerStop",
  "_clearScr",
  "_drawRect",
  "_drawText",
  "_dispUp",
  "EffSetCon",
  "Exit",
  "_t",
  "_gc",
  "_mr_entry",
  "_mr_param",
  "dealevent",
  "dealtimer",
  "suspend",
  "resume",
  "mr_event",
  "mr_timer",
  "advance",
  "step",
] as const;

export const IMPLEMENTED_B = [
  "_strCom/602",
  "file.open",
  "file.close",
  "file.state",
  "file.readAll",
  "f.read",
  "f.seek",
  "f.write",
  "sys.getuptime",
  "sys.getFileLen",
  "sys.getFileInfo",
  "GetDatetime",
  "_rand",
  "_mod",
  "_and",
  "_or",
  "_xor",
  "_not",
  "_drawLine",
  "_drawPoint",
  "_dispUpEx",
  "_com/100",
  "_com/101",
  "_com/102",
  "_com/401",
  "_com/406",
] as const;

export const IMPLEMENTED_C = [
  "string.len",
  "string.sub",
  "string.pack",
  "string.unpack",
  "string.subV",
  "table.rawGet",
  "table.getn",
  "_setTab",
  "SaveTable",
  "LoadTable",
  "_runFile",
  "_strCom/300",
  "_strCom/500",
  "_strCom/501",
  "_strCom/502",
  "BitmapShow",
  "SpriteDraw",
  "TileDraw",
  "metamethod/__index",
  "metamethod/__newindex",
  "mr_table/0",
  "mr_table/14",
  "mr_table/125",
  "mr_table/130/7",
  "mr_table/38/0x4c6",
  "mr_table/33/mr_getTime",
  // Only the observed guest sprintf subset consisting of
  // literal bytes and %d is currently implemented.
  "mr_table/17/sprintf/%d",
  // 128-byte guest data slot. Populated from current pack identity
  // (MythroadRuntime.packName) with rxgj arm_ext_set_pack_table_name
  // memset+snprintf semantics. Not a function ABI / filesystem API.
  "mr_table/100/pack_filename",
  // Deterministic read-only virtual file alias for the currently loaded
  // MRP container. Other filenames and write modes remain unsupported.
  "mr_table/40/current-pack/RDONLY+appfs",
  "mr_table/44/read",
  "mr_table/45/seek",
  "mr_table/41/close",
  "mr_table/43/mr_write/appfs",
  // Forward byte-copy. Not memmove. count==0 does not touch pointers.
  "mr_table/3/memcpy2",
  // Guest byte-string compare. unsigned char. Returns -1/0/1.
  "mr_table/10/strcmp2",
  // Guest byte-wise memcmp2. unsigned char. Early exit.
  // Returns exact *su1-*su2, not libc-clamped -1/0/1.
  "mr_table/9/memcmp2",
  // Valid flymrp bump allocations are retired from the live registry.
  // Address reuse / origin_mem free-list coalescing is not implemented.
  "mr_table/1/mr_free/registry-only",
  // rxgj FULL gb16 metrics. Generated glyphs, not gb16.uc2.
  "mr_table/30/mr_getCharBitmap",
  // rxgj FULL: mr_plat(1206) → MR_CHINESE; 1205 → MR_TOUCH_SCREEN.
  "mr_table/37/mr_plat/1206+1205",
  // rxgj FULL mr_printf: literals + %d + %s. Return 0.
  "mr_table/26/mr_printf",
  // Pack name → MR_IS_FILE. App-fs dirs/files. Archive members → MR_IS_INVALID.
  "mr_table/42/mr_info",
  // In-memory mkdir. Not host FS / IndexedDB.
  "mr_table/49/mr_mkDir",
  // Guest strcpy including NUL. Returns dest.
  "mr_table/5/strcpy2",
  // flymrp DeviceProfile fill of mr_userinfo. Not a real IMEI.
  "mr_table/35/mr_getUserInfo",
  // rxgj FULL: always MR_NET_ID_MOBILE. Not a real radio.
  "mr_table/61/mr_getNetworkID",
  // Guest strlen until NUL.
  "mr_table/15/strlen2",
  // Guest strncpy: exactly count bytes, NUL-pad after src ends.
  "mr_table/6/strncpy2",
  // rxgj atol2/atoi2. No whitespace / plus.
  "mr_table/18/atoi2",
  // Guest strcat including NUL. Returns dest.
  "mr_table/7/strcat2",
  // RGB565 clip-fill. Void ABI returns MR_SUCCESS.
  "mr_table/122/DrawRect",
  // Generated gb16 glyphs. Not device UC2. Return 0.
  "mr_table/123/DrawText/generated-gb16",
  // NULL bmp presents host RGB565 cache.
  "mr_table/29/mr_drawBitmap/host-present",
  // rxgj FULL: mr_winCreate / mr_winRelease → MR_IGNORE.
  "mr_table/78/mr_winCreate/MR_IGNORE",
  // Platform one-shot timer. Deterministic virtual clock. Not wall-clock.
  "mr_table/31/mr_timerStart",
  "mr_table/32/mr_timerStop",
  // Host ScreenBuffer width/height, bit=16. Not a guest framebuffer pointer.
  "mr_table/80/mr_getScreenInfo",
  // C _DrawBitmap. Guest RGB565 source. ROP from mr_helper.h enum (COPY=2).
  "mr_table/120/DrawBitmap",
  // Guest RGB565 cache → RGBA ImageData. Not device-LCD pixel-perfect.
  "graphics/canvas2d/rgb565-present",
  // No PCM/MIDI device. SUCCESS + record. Guest data* is not a host pointer.
  "mr_table/57/mr_playSound",
  "mr_table/58/mr_stopSound",
  // void platDrawChar; RGB565 color; generated gb16. Not UC2.
  "mr_table/145/mr_platDrawChar",
] as const;
