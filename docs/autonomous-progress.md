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
| 37 | mr_plat | PARTIAL | only code 1206 → `MR_CHINESE` 1000 |
| 40/44/45/41 | file | PARTIAL | current-pack RDONLY alias |
| 42 | mr_info | PARTIAL | pack name → IS_FILE；其它含 archive member → IS_INVALID |
| 49 | mr_mkDir | PARTIAL | in-memory EFS dir; not IndexedDB |
| 5 | strcpy2 | SUPPORTED | NUL-terminated copy, returns dest |
| 6 | strncpy2 | SUPPORTED | exactly count bytes; NUL-pad after src |
| 7 | strcat2 | SUPPORTED | append including NUL |
| 15 | strlen2 | SUPPORTED | count until NUL |
| 18 | atoi2 | SUPPORTED | rxgj `atol2`; no whitespace / plus |
| 35 | mr_getUserInfo | PARTIAL | flymrp DeviceProfile fill; not a real IMEI |
| 38 | mr_platEx | PARTIAL | 0x4c6 SUCCESS; 1204 Y/Z/X/A/B/C work-path; not full platEx |
| 122 | DrawRect | BLOCKED | LIVE `DrawRect(0,0,0,0,0,0,0)`; 7-arg AAPCS |
| 61 | mr_getNetworkID | PARTIAL | always `MR_NET_ID_MOBILE`; not a real radio |
| 100 | pack_filename | SUPPORTED | 128-byte data slot |
| 125 | readFile | SUPPORTED | VFS member |
| 130 | TestCom | PARTIAL | case 7 only |

### other

| area | status |
|---|---|
| `_strCom` 601/800/801 | SUPPORTED on observed path |
| Lua resume after `arm_ext_call(0)` | BLOCKED |
| graphics | BLOCKED | table[122] DrawRect reached in startup |
| timer / event / input | DEFERRED until Lua resumes |
| audio / network / SMS / WAP | OPTIONAL / DEFERRED |
| writable VFS / save | UNKNOWN / DEFERRED |
| `mr_platEx(1204)` SWITCHPATH | PARTIAL |
| `table[122]` DrawRect | BLOCKED |

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
| plat 1206 only | `MR_CHINESE` | other plat codes | only 1206 observed | later device queries |
| printf subset | `%d` `%s` width | `%x` flags precision | LIVE SDK formats covered | new specifier stops |
| generated gb16 glyphs | metrics + packed bits | real `gb16.uc2` / `gb12.uc2` | width/height CONFIRMED; pixels not claimed pixel-perfect | text drawing will not match device |
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

**commit:** Implement confirmed platEx MR_SWITCHPATH query

## Current blocker

```text
table[122]  asm_DrawRect
LIVE        DrawRect(0, 0, 0, 0, 0, 0, 0)
            r0-r3 = 0; [sp]/[sp+4]/[sp+8] = 0
PC=0x000101e8  LR=0x01ea6e11
category    GRAPHICS
```

rxgj `DrawRect(int16 x,y,w,h, uint8 r,g,b)` clips and fills `MR_SCREEN_CACHE` RGB565. Zero-size is a no-op in source but the ABI must exist. 7-arg AAPCS. Do not skip guest framebuffer semantics.
