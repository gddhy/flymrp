# Autonomous real-MRP progress

长期目标：真实 `test/fixtures/real/app.mrp` 在 flymrp 中完成启动并进入稳定可交互运行。  
**不要 push。** Stage 5-C **NOT COMPLETE**。Stage 5-D **NOT STARTED**。

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
| 40/44/45/41 | file | PARTIAL | current-pack RDONLY; EFS `gssjxz\\69` **BLOCKED** |
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

### other

| area | status |
|---|---|
| `_strCom` 601/800/801 | SUPPORTED on observed path |
| Lua resume after `arm_ext_call(0)` | BLOCKED |
| graphics | PARTIAL | 1 rect + 1 text + 2 presents; no Canvas backend yet |
| timer / event / input | DEFERRED until Lua resumes |
| audio / network / SMS / WAP | OPTIONAL / DEFERRED |
| writable VFS / save | UNKNOWN / DEFERRED |
| `mr_platEx(1204)` SWITCHPATH | PARTIAL |
| `mr_plat(1205)` CHECK_TOUCH | PARTIAL | rxgj FULL `MR_TOUCH_SCREEN` |
| EFS `mr_open("gssjxz\\69")` | BLOCKED | not current-pack; CREATE loop if return 0 |

---

## Compatibility simplifications

| item | implemented | not implemented | why current app is safe | future risk |
|---|---|---|---|---|
| registry-only `mr_free` | retire live bump allocs | origin_mem reuse/coalesce | guest does not depend on reuse yet | later allocator-sensitive code |
| current-pack RDONLY file | open/read/seek/close pack bytes | other names, write, EFS | `_mr_readFile` uses pack name | `game.sav` / write still need a separate namespace |
| mr_info pack-or-appfs | pack name IS_FILE; app-fs dir/file; else INVALID | host FS / IndexedDB | LIVE `dbglog.txt` is INVALID; `gsidbak` becomes DIR after mkdir | archive member must stay INVALID |
| in-memory AppFileSystem | mkdir + info | open/read/write/persist | only mkdir/info observed so far | later `game.sav` needs file create + persist |
| sprintf `%d` only | LIVE `res_lang%d.rc` | `%s` / width | only one production sprintf so far | new format → `UnknownAbiError` |
| platEx 0x4c6 + SWITCHPATH | 0x4c6 SUCCESS; Y/Z/X/A/B/C work-path | other platEx codes | LIVE Y then B:/mythroad/ then c:/mythroad/ | later 1014 SCRRAM / other codes |
| DSM work path | in-memory `dsmWorkPath`; Y writes guest `c:/mythroad/` | host FS / IndexedDB mapping | current-pack open still uses pack name | later `B:` prefixed mr_open |
| plat 1206+1205 | `MR_CHINESE` / `MR_TOUCH_SCREEN` | other plat codes | LIVE 1206 then 1205 | Android rxgj returns NORMAL_SCREEN for 1205 |
| printf subset | `%d` `%s` width | `%x` flags precision | LIVE SDK formats covered | new specifier stops |
| generated gb16 glyphs | metrics + packed bits | real `gb16.uc2` / `gb12.uc2` | width/height CONFIRMED; pixels not claimed pixel-perfect | text drawing will not match device |
| NULL `mr_drawBitmap` | present host RGB565 cache | guest-mapped `mr_screenBuf` | guest draws via DrawRect/DrawText into host cache | later apps that pass a guest bmp pointer |
| winCreate/Release IGNORE | return `MR_IGNORE` | window objects / focus | rxgj FULL `dsm.c` same | GUI-heavy apps |
| flymrp getUserInfo | IMEI/IMSI zeros; packed ver 101020180 | real handset / rxgj IMEI | guest only used IMSI strlen/atoi prefix | later billing / SMS / license checks |
| getNetworkID always MOBILE | return 0 | real SIM / radio | startup probe only so far | later SMS / netpay paths |

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
