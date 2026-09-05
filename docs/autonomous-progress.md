# Autonomous real-MRP progress

长期目标：真实 `test/fixtures/real/app.mrp` 在 flymrp 中完成启动并进入稳定可交互运行。  
**不要 push。** Stage 5-C **COMPLETE**。Stage 5-D **STARTED**。

基线 HEAD（goal 开始时）：`fc03f8c` / `84e17c3`。以实际 HEAD 为准。

---

## Ledger

### mr_table

| slot | API | status | notes |
|---|---|---|---|
| 0 | malloc | SUPPORTED | bump alloc |
| 1 | mr_free | PARTIAL | registry-only；无 origin_mem reuse |
| 3 | memcpy2 | SUPPORTED | forward byte-copy，非 memmove |
| 9 | memcmp2 | SUPPORTED | unsigned char exact diff |
| 10 | strcmp2 | SUPPORTED | -1/0/1 |
| 14 | memset2 | SUPPORTED | |
| 17 | sprintf_ | PARTIAL | literal + `%d` only |
| 25 | set P/helper | SUPPORTED | guest |
| 26 | mr_printf | PARTIAL | literals / `%d` / `%s` / width |
| 30 | mr_getCharBitmap | PARTIAL | gb16 metrics CONFIRMED；glyphs generated, not UC2 |
| 33 | mr_getTime | SUPPORTED | `runtime.clock >>> 0` |
| 37 | mr_plat | PARTIAL | 1206 → `MR_CHINESE`; 1205 → `MR_TOUCH_SCREEN` (rxgj FULL) |
| 40/44/45/41/43 | file | PARTIAL | current-pack RDONLY + AppFS EFS create/write |
| 42 | mr_info | PARTIAL | pack name → IS_FILE；其它含 archive member → IS_INVALID |
| 49 | mr_mkDir | PARTIAL | in-memory EFS dir; not IndexedDB |
| 5 | strcpy2 | SUPPORTED | NUL-terminated copy, returns dest |
| 6 | strncpy2 | SUPPORTED | exactly count bytes; NUL-pad after src |
| 7 | strcat2 | SUPPORTED | append including NUL |
| 15 | strlen2 | SUPPORTED | count until NUL |
| 18 | atoi2 | SUPPORTED | rxgj `atol2`; no whitespace / plus |
| 35 | mr_getUserInfo | PARTIAL | flymrp DeviceProfile fill; not a real IMEI |
| 38 | mr_platEx | PARTIAL | 0x4c6 SUCCESS; 1204 Y/Z/X/A/B/C work-path; not full platEx |
| 122 | DrawRect | PARTIAL | RGB565 clip-fill; LIVE zero-size black rect |
| 61 | mr_getNetworkID | PARTIAL | always `MR_NET_ID_MOBILE`; not a real radio |
| 100 | pack_filename | SUPPORTED | 128-byte data slot |
| 125 | readFile | SUPPORTED | VFS member |
| 123 | DrawText | PARTIAL | generated gb16; LIVE unicode=1 white text at (88,160) |
| 29 | mr_drawBitmap | PARTIAL | NULL = present host ScreenBuffer; LIVE twice |
| 78 | mr_winCreate | PARTIAL | rxgj FULL `MR_IGNORE`; no window object |
| 79 | mr_winRelease | PARTIAL | rxgj FULL `MR_IGNORE`; not LIVE yet |
| 130 | TestCom | PARTIAL | case 7 only |
| 31 | mr_timerStart | PARTIAL | uint16 ms; LIVE 80; owner = current/active/wrapper |
| 32 | mr_timerStop | PARTIAL | zero-arg; leftover R0 ignored |
| 80 | mr_getScreenInfo | PARTIAL | host 240×320 bit=16 |
| 120 | _DrawBitmap | PARTIAL | C rop `DRAW_BM_*` (COPY=2); guest RGB565 via GuestMemory; not Lua `BM_COPY=0` |
| 57 | mr_playSound | PARTIAL | AAPCS type/data*/len/loop; SUCCESS + record; no PCM/MIDI device; data stays guest |
| 58 | mr_stopSound | PARTIAL | AAPCS type; leftover r1–r3 ignored; SUCCESS + record; LIVE type=0 |

### other

| area | status |
|---|---|
| `_strCom` 601/800/801 | SUPPORTED on observed path |
| Lua resume after `arm_ext_call(0)` | SUPPORTED on this fixture path |
| graphics | PARTIAL | DrawRect + DrawText + DrawBitmap + Canvas2D RGB565 present; not device-LCD pixel-perfect |
| timer / event / input | PARTIAL | timer + frames PASS; FIRE→RW LIVE; SOFTRIGHT on 开启声音？ changes pixels after next timer |
| audio / network / SMS / WAP | OPTIONAL / DEFERRED | play/stopSound SUCCESS no device; no SMS/WAP |
| writable VFS / save | UNKNOWN / DEFERRED |
| `mr_platEx(1204)` SWITCHPATH | PARTIAL |
| `mr_plat(1205)` CHECK_TOUCH | PARTIAL | rxgj FULL `MR_TOUCH_SCREEN` |
| EFS `mr_open("gssjxz\\69")` | PARTIAL | AppFS create/write; not pack member `69.bmp` |
| table[31] `mr_timerStart` | PARTIAL | EXT armed 80ms; owner = current/active/wrapper; not full LR resolve |
| table[32] `mr_timerStop` | PARTIAL | zero-arg; leftover R0 ignored |
| table[80] `mr_getScreenInfo` | PARTIAL | host 240×320 bit=16 cache; not a guest framebuffer pointer |

---

## Compatibility simplifications

| item | implemented | not implemented | why current app is safe | future risk |
|---|---|---|---|---|
| registry-only `mr_free` | retire live bump allocs | origin_mem reuse/coalesce | guest does not depend on reuse yet | later allocator-sensitive code |
| current-pack RDONLY file | open/read/seek/close pack bytes | pack write modes | `_mr_readFile` uses pack name | must not alias archive members as EFS |
| AppFS in-memory EFS | mkdir/info/create/read/write; CREATE auto-parents | persist / IndexedDB / host FS | LIVE `gssjxz\\69` is DSM work-path, not `69.bmp` | `game.sav` still needs a persistent namespace |
| mr_info pack-or-appfs | pack name IS_FILE; app-fs dir/file; else INVALID | host FS / IndexedDB | LIVE `dbglog.txt` is INVALID; `gsidbak` becomes DIR after mkdir | archive member must stay INVALID |
| sprintf `%d` only | LIVE `res_lang%d.rc` | `%s` / width | only one production sprintf so far | new format → `UnknownAbiError` |
| platEx 0x4c6 + SWITCHPATH | 0x4c6 SUCCESS; Y/Z/X/A/B/C work-path | other platEx codes | LIVE Y then B:/mythroad/ then c:/mythroad/ | later 1014 SCRRAM / other codes |
| DSM work path | in-memory `dsmWorkPath`; Y writes guest `c:/mythroad/` | host FS / IndexedDB mapping | current-pack open still uses pack name | later `B:` prefixed mr_open |
| plat 1206+1205 | `MR_CHINESE` / `MR_TOUCH_SCREEN` | other plat codes | LIVE 1206 then 1205 | Android rxgj returns NORMAL_SCREEN for 1205 |
| printf subset | `%d` `%s` width | `%x` flags precision | LIVE SDK formats covered | new specifier stops |
| generated gb16 glyphs | metrics + packed bits | real `gb16.uc2` / `gb12.uc2` | width/height CONFIRMED; pixels not claimed pixel-perfect | text drawing will not match device |
| NULL `mr_drawBitmap` | present host RGB565 cache | guest-mapped `mr_screenBuf` | guest draws via DrawRect/DrawText into host cache | later apps that pass a guest bmp pointer |
| winCreate/Release IGNORE | return `MR_IGNORE` | window objects / focus | rxgj FULL `dsm.c` same | GUI-heavy apps |
| timer owner not LR-range | owner = current \|\| active \|\| wrapper | full LR-range module resolve | LIVE start after AppFS uses current/wrapper | nested EXT timer callbacks |
| generated gb16 (timer path) | metrics + packed bits | real `gb16.uc2` | startup text already used generated glyphs | later fonts |
| C `_DrawBitmap` rop `DRAW_BM_*` | COPY/TRANSPARENT/GRAY/OR/XOR/NOT + sprite rotate | pixel-perfect device blit / `DrawBitmapEx` | LIVE blit uses guest RGB565; Lua `BM_COPY=0` is a different alias | mixing the two enums |
| Canvas2D RGB565 present | guest cache → RGBA ImageData | dirty-rect / DOM-only backend | present is host conversion; guest pixels unchanged | assuming 5/6-bit expand matches a phone LCD |
| this-fixture key remap | PRESS+FIRE → ER_RW+180 `0x0109` | universal Mythroad key map | LIVE gssjxz `mrc_event` write; start.mr packs `iii` 12 bytes | other apps / 20-byte `mr_c_event_st` |
| flymrp getUserInfo | IMEI/IMSI zeros; packed ver 101020180 | real handset / rxgj IMEI | guest only used IMSI strlen/atoi prefix | later billing / SMS / license checks |
| getNetworkID always MOBILE | return 0 | real SIM / radio | startup probe only so far | later SMS / netpay paths |
| play/stopSound no device | SUCCESS + record | PCM/MIDI output / decode | LIVE `mr_stopSound(0)` after extracting `gssjxz\\71`–`79`/`18`; dialog advances | later apps that poll play position |
| 8M ARM watchdog | start 1.60M + sound-dialog extract 5.10M | slice / infinite guest | per-`runGuest` finite cap; max 20M | a longer extract than 8M |

---

## Log

### 2026-09-05 — table[30]/[37]/[26]

**starting blocker:** `table[30] mr_getCharBitmap`（5-C.10R）

**analysis:**

* 30 = `asm_mr_getCharBitmap`。LIVE R0=`0x662f`（U+662F）R1=0 R2/R3 out-pointers。无 UC2 → gb16 metrics。
* 37 = `mr_plat(1206)` → `MR_CHINESE` 1000。rxgj FULL。
* 26 = `mr_printf`。LIVE `SDK%s%dv%d%s)` 然后 `SDKv%d.%d.%d.%2d(%dv%d%s)`。需要 `%s` 与 width。

**implementation:**

* `src/mythroad/font.ts` gb16 metrics + generated glyphs
* `MrTableBridge.getCharBitmap` / `plat(1206)` / `printf`
* `guestPrintf` literals/`%d`/`%s`/width；return 0

**tests:** `getcharbitmap-30-abi` / `plat-37-abi` / `printf-26-abi` + 全量 production baselines 改到 slot 42

**real-run:**

```text
previous blocker   table[30]
new blocker        table[42] mr_info  name=dbglog.txt
mr_table last      ...,30,14,37,26x2,42
ARM insn           1,405,023
Lua insn           71
hits               3554
arm_ext_call(0)    not returned
Lua                not resumed
```

**commit:** Implement confirmed getCharBitmap, plat language, and printf ABI

---

### 2026-09-05 — table[42] mr_info

**starting blocker:** `table[42] mr_info("dbglog.txt")`

**analysis:** `mr_info` 是平台文件系统查询。LIVE 先查 `dbglog.txt`，再查 `gsidbak`。rxgj：MRP 内资源不是已安装 EFS。

**implementation:** pack name → `MR_IS_FILE`；其它（含 archive member）→ `MR_IS_INVALID`。

**real-run:**

```text
previous blocker   table[42]
new blocker        table[49] mr_mkDir  name=gsidbak
ARM insn           1,405,059
Lua insn           71
hits               3557
```

**commit:** `a105f4f` Implement confirmed mr_info pack-or-invalid ABI

### 2026-09-05 — mkdir + strcpy2

**starting blocker:** `table[49] mr_mkDir("gsidbak")`

**implementation:** in-memory `AppFileSystem`（与 pack/archive 分离）；`strcpy2` 按 `string.c` 含 NUL。guest 随后再次 RDONLY open pack 读 header 字段。

**real-run:**

```text
previous blocker   table[49]
new blocker        table[35] mr_getUserInfo
ARM insn           1,405,411
Lua insn           71
hits               3572
handles            1, 2
```

**commit:** `5d36ce5` Support in-memory mkdir and confirmed strcpy2 ABI

---

### 2026-09-05 — getUserInfo + identity string cluster

**starting blocker:** `table[35] mr_getUserInfo`

**analysis:**

* 35 = 64-byte `mr_userinfo`. LIVE info=`0x002046a0`. Fill from flymrp `DeviceProfile`, not rxgj's real-looking IMEI.
* 61 = `mr_getNetworkID` → `MR_NET_ID_MOBILE` (rxgj FULL / `aex_t061`).
* 15/6/18 = `strlen(IMSI)` + `strncpy(3)` + `atoi2` of the IMSI prefix.
* 7 = `strcat2` path-string build, then `mr_platEx(1204)`.

**implementation:** `getUserInfo` / `getNetworkID` / `strlen2` / `strncpy2` / `atoi2` / `strcat2`.

**real-run:**

```text
previous blocker   table[35]
new blocker        mr_platEx(1204) MR_SWITCHPATH LIVE 'Y'
ARM insn           1,405,946
Lua insn           71
hits               3617
handles            1, 2, 3
```

**commit:** `5414115` Implement confirmed getUserInfo and identity string ABI

---

### 2026-09-05 — platEx 1204 MR_SWITCHPATH

**starting blocker:** `mr_platEx(1204)` `MR_SWITCHPATH` LIVE `'Y'`

**analysis:**

* rxgj `dsmSwitchPath`. `'Y'` queries `dsmWorkPath` (default `mythroad/`) → guest `"c:/mythroad/"`.
* LIVE next: `"B:/mythroad/"` (len=12) then `"c:/mythroad/"` (len=12).
* `'B'` + suffix → `mythroad/disk/b/` + `mythroad/`. `'Y'` after hide-drive formats `"b:/mythroad/"`.
* Not a host filesystem. `*output` is a reused guest EXT buffer.

**implementation:** `dsmSwitchPath` Y/Z/X/A/B/C + `SetDsmWorkPath`. Unknown letters `MR_IGNORE`.

**tests:** `test/real/platex-38-abi.test.ts`; real `app.mrp` rerun.

**real-run:**

```text
previous blocker   mr_platEx(1204) SWITCHPATH 'Y'
new blocker        table[122] DrawRect(0,0,0,0,0,0,0)
ARM insn           1,412,613
Lua insn           71
hits               3731
handles            1, 2, 3, 4
```

**commit:** `7a79f0f` Implement confirmed platEx MR_SWITCHPATH query

---

### 2026-09-05 — DrawRect / DrawText / drawBitmap / winCreate

**starting blocker:** `table[122]` `DrawRect(0,0,0,0,0,0,0)`

**analysis:**

* rxgj `DrawRect` clips and fills RGB565 `MR_SCREEN_CACHE`. 7-arg AAPCS. LIVE is a zero-size black rect.
* `DrawText` LIVE: unicode=1 font=0 white at `(88,160)`, BE UTF-16 + U+2026. Glyphs are generated gb16, not `gb16.uc2`.
* `mr_drawBitmap` LIVE twice: `bmp=NULL, (0,0,240,h)`. Guest has no mapped `mr_screenBuf`; NULL presents the host cache.
* `mr_winCreate` LIVE; rxgj `dsm.c` / `aex_t078` → `MR_IGNORE`. Same for `winRelease`.

**implementation:** host RGB565 `ScreenBuffer`; DrawRect/DrawText/drawBitmap/winCreate/winRelease. Lua `_drawRect`/`_clearScr`/`_drawText` share the same buffer.

**tests:** `test/real/drawrect-122-abi.test.ts`, `drawtext-123-abi.test.ts`, `drawbitmap-29-abi.test.ts`, `wincreate-78-abi.test.ts`; real `app.mrp` rerun.

**real-run:**

```text
previous blocker   table[122] DrawRect
new blocker        mr_plat(1205) MR_CHECK_TOUCH
ARM insn           1,412,903
Lua insn           71
hits               3739
graphicsCommands   4  (1 rect + 1 text + 2 flush)
handles            1, 2, 3, 4
```

**commit:** `49fb888` Support DrawRect, DrawText, and bitmap present

---

### 2026-09-05 — mr_plat(1205) MR_CHECK_TOUCH

**starting blocker:** `mr_plat(1205, 0)`

**analysis:**

* rxgj FULL `dsm.c`: `return MR_TOUCH_SCREEN` (`1001`). Android jni returns `MR_NORMAL_SCREEN`.
* LIVE after DrawRect/DrawText/two presents/winCreate.

**implementation:** `mr_plat(1205)` → `1001`. Marked rxgj FULL.

**tests:** `test/real/plat-37-abi.test.ts`; real `app.mrp` rerun.

**real-run:**

```text
previous blocker   mr_plat(1205)
new blocker        mr_open("gssjxz\\69") mode=RDONLY
ARM insn           1,413,669
Lua insn           71
hits               3745
graphicsCommands   4
```

Probe: returning 0 makes guest retry RDONLY then CREATE (mode 12) in a loop until watchdog. File is required EFS, not pack member `69.bmp`.

**commit:** Implement confirmed plat MR_CHECK_TOUCH

## Current blocker

```text
mr_open("gssjxz\\69")  mode=1 (RDONLY)
PC=0x000100a0  LR=0x01ea89e7  R0=0x01e7ff34
category       FILE
```

Guest strcat `gssjxz` + `\\` + `69`. Archive has `69.bmp` but this is DSM work-path EFS (`mythroad/gssjxz/69`), not current-pack and not a VFS member. Missing RDONLY → 0 then CREATE 12 loop. Next: AppFS create/write, still separate from pack resources.

---

### 2026-09-05 — AppFS EFS create/write

**starting blocker:** `mr_open("gssjxz\\69")` mode=RDONLY

**analysis:**

* Guest strcat `"gssjxz"` + `"\\"` + `"69"` → `"gssjxz\\69"`.
* Archive member `69.bmp` is **not** this file. DSM work-path EFS, not current-pack.
* Probe: RDONLY miss → 0 then CREATE mode 12 (`MR_FILE_RDWR|MR_FILE_CREATE`) until watchdog. File is required.
* CREATE auto-creates parent dirs in memory (flymrp AppFS simplification).

**implementation:** AppFS create/write + table[43] `mr_write`. Pack name + RDONLY stays current-pack alias. Other names miss without CREATE return 0.

**tests:** `test/real/appfs-file-abi.test.ts`; `test/mythroad/pack-file.test.ts`; real `app.mrp` rerun.

**real-run:**

```text
previous blocker   mr_open("gssjxz\\69")
new blocker        table[32] mr_timerStop
ARM insn           1,596,421
Lua insn           71
hits               4861
graphicsCommands   6
handles            1..10
writes             table[43] x8
category           TIMER
```

**commit:** Support in-memory EFS create and write

---

### 2026-09-05 — timer + getScreenInfo; Stage 5-C COMPLETE

**starting blocker:** `table[32] mr_timerStop`

**analysis:**

* rxgj: `int32 mr_timerStart(uint16 t)` / `int32 mr_timerStop(void)`. Host `main.c` both return `MR_SUCCESS`.
* LIVE: stop is zero-arg (R0=stub leftover); start `r0=80` (80ms).
* Immediately after: table[29] present + table[80] `mr_getScreenInfo` (240×320×16).
* After 80, `arm_ext_call(0)` returns `r0=0`; `_strCom(801,...,0)` returns to Lua.

**implementation:** table[31]/[32] → `MythroadTimer`; table[80] writes host `ScreenBuffer` width/height/`bit=16`. Timer owner = current/active/wrapper (not full LR resolve).

**tests:** `test/real/timer-31-32-abi.test.ts`; `test/real/getscreeninfo-80-abi.test.ts`; real `app.mrp` baseline retargeted to completed startup.

**real-run:**

```text
previous blocker   table[32] mr_timerStop
new blocker        (none on start(); Stage 5-D: timer fire / frames / input)
arm_ext_call(0)    kind=return  r0=0  insn=1,596,592
_strCom(801,0)     ok=true  returnedToLua=true
Lua                RESUMES  luaInsn=73
hits               4864
last slot          80 REAL_EXECUTED
graphicsCommands   7
timer              RUNNING interval=80 events=0 clock=0
category           EVENT
Stage 5-C          COMPLETE
Stage 5-D          STARTED
```

**commit:** Implement confirmed timer and getScreenInfo ABI

---

### 2026-09-05 — table[120] `_DrawBitmap`

**starting blocker:** `UNKNOWN_REQUIRED_SLOT = 120` on first `advance(80)+step`

**analysis:**

* `_mr_c_function_table[120] = asm_DrawBitmap`. C 10-arg `_DrawBitmap`.
* AAPCS: r0–r3 = p,x,y,w; `[sp+0..+20]` = h,rop,trans,sx,sy,mw.
* C rop enum `BM_COPY=2` / `BM_TRANSPARENT=6`（`mr_helper.h`），不是 Lua 测试别名 `BM_COPY=0`。

**implementation:** `ScreenBuffer.drawBitmapRop` + `MrTableBridge.drawBitmapRop`；guest `p` 经 `GuestMemory.read16`；`p=0` no-op SUCCESS。

**tests:** `test/real/drawbitmap-120-abi.test.ts`

**real-run:** start 后 `advance(80)+step` 三次：`arm_ext_call(2)` RETURN；flushes 持续增加；timer 保持 80ms；无 unknown slot。

**commit:** Implement confirmed DrawBitmap blit ABI

---

### 2026-09-05 — Canvas2D + Stage 5-D loop / input

**starting blocker:** first `advance(80)+step` needed table[120]; input looked like a no-op

**analysis:**

* table[120] closed above. Timer `arm_ext_call(2)` draws every 80ms; 20 frames have 2 unique checksums (splash animates).
* `start.mr` `dealevent` packs `string.pack("iii", type, p1, p2)` then `_strCom(801, d_s, 1)`.
* `arm_ext_call(1)` 172 insns, no new table slots. Guest writes remapped key at ER_RW+180:
  FIRE PRESS=`0x0109`, UP=`0x0103`, DOWN=`0x0102`, SOFTLEFT=`0x010A`, RELEASE=`0x00FF`.
* Next timer frame does not change pixels. Splash stores the key; visible menu reaction 未证.
* `primary` still 0; helper is wrapper `0x01ea5e9d`.

**implementation:** `rgb565ToRgba` + `Canvas2DBackend` (guest cache → ImageData). No DOM types.

**tests:** `test/mythroad/canvas2d.test.ts`; `test/real/stage5d-runtime.test.ts`

**real-run:**

```text
previous blocker   table[120] / input unknown
new blocker        splash ignores keys for pixels; Stage 5-D not COMPLETE
arm_ext_call(2)    RETURN every 80ms
arm_ext_call(1)    RETURN insn=172  FIRE→ER_RW+180=0x0109
Canvas             presents 240×320 RGBA
category           EVENT
```

**commit:** Support Canvas2D RGB565 present / Add Stage 5-D runtime loop tests

---

### 2026-09-05 — sound dialog input + table[57]/[58]

**starting blocker:** splash/title 按键写 ER_RW+180 但不改像素

**analysis:**

* 24 帧后画面是 TrumpTek splash 上的 **「开启声音？」**，软键 **是/否**（generated gb16 看起来像 tofu）。
* FIRE 只写 `0x0109`，不是 是/否。
* SOFTLEFT/SOFTRIGHT 会从 `gssjxz.mrp` 抽出 `gssjxz\\71`–`79`/`18` 到 AppFS（不是把 archive member 当成 EFS）。
* 该 `arm_ext_call(1)` 约 **5,096,611** insn，然后 LIVE `table[58] mr_stopSound(0)`。
* 默认 2M watchdog 会在抽出中途 `abi-fault`。8M 覆盖这条路径。
* 下一帧 timer checksum `798243022` → `2567031015`。

**implementation:**

* `table[57]`/`[58]`：AAPCS CONFIRMED（`aex_t057`/`aex_t058`）；SUCCESS + record；无 PCM/MIDI 设备。
* `DEFAULT_INSN_BUDGET` 2e6 → 8e6（上限仍 20e6）。
* Input alias `SOFTLEFT`/`SOFTRIGHT`。

**tests:** `playsound-57-58-abi`；`stage5d` SOFTRIGHT 像素变化；budget 默认值改为 8e6。

**real-run:**

```text
arm_ext_call(1)  kind=return  r0=0  insn=5,096,611
mr_stopSound(0)  SUCCESS
next timer       checksum 798243022 → 2567031015
unknown          null
```

**commit:** Implement confirmed play/stopSound ABI and raise event watchdog

## Current blocker

```text
startup + timer + Canvas + SOFTRIGHT pixel reaction PASS
Stage 5-D interactive path proven on this fixture
remaining optional: UC2 font, real audio device, persist EFS, network/SMS
realAppGreen stays false (gate / not device-LCD green)
```
