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
| 38 | mr_platEx | PARTIAL | only 0x4c6 → `MR_SUCCESS` |
| 40/44/45/41 | file | PARTIAL | current-pack RDONLY alias |
| 42 | mr_info | PARTIAL | pack name → IS_FILE；其它含 archive member → IS_INVALID |
| 49 | mr_mkDir | PARTIAL | in-memory EFS dir; not IndexedDB |
| 5 | strcpy2 | SUPPORTED | NUL-terminated copy, returns dest |
| 35 | mr_getUserInfo | BLOCKED | LIVE info* `0x002046a0` |
| 100 | pack_filename | SUPPORTED | 128-byte data slot |
| 125 | readFile | SUPPORTED | VFS member |
| 130 | TestCom | PARTIAL | case 7 only |

### other

| area | status |
|---|---|
| `_strCom` 601/800/801 | SUPPORTED on observed path |
| Lua resume after `arm_ext_call(0)` | BLOCKED |
| graphics / timer / event / input | DEFERRED until Lua resumes |
| audio / network / SMS / WAP | OPTIONAL / DEFERRED |
| writable VFS / save | UNKNOWN / DEFERRED |

---

## Compatibility simplifications

| item | implemented | not implemented | why current app is safe | future risk |
|---|---|---|---|---|
| registry-only `mr_free` | retire live bump allocs | origin_mem reuse/coalesce | guest does not depend on reuse yet | later allocator-sensitive code |
| current-pack RDONLY file | open/read/seek/close pack bytes | other names, write, EFS | `_mr_readFile` uses pack name | `game.sav` / write still need a separate namespace |
| mr_info pack-or-appfs | pack name IS_FILE; app-fs dir/file; else INVALID | host FS / IndexedDB | LIVE `dbglog.txt` is INVALID; `gsidbak` becomes DIR after mkdir | archive member must stay INVALID |
| in-memory AppFileSystem | mkdir + info | open/read/write/persist | only mkdir/info observed so far | later `game.sav` needs file create + persist |
| sprintf `%d` only | LIVE `res_lang%d.rc` | `%s` / width | only one production sprintf so far | new format → `UnknownAbiError` |
| platEx 0x4c6 only | `MR_SUCCESS` no side effects | other platEx codes | only 0x4c6 observed | later platform probes |
| plat 1206 only | `MR_CHINESE` | other plat codes | only 1206 observed | later device queries |
| printf subset | `%d` `%s` width | `%x` flags precision | LIVE SDK formats covered | new specifier stops |
| generated gb16 glyphs | metrics + packed bits | real `gb16.uc2` / `gb12.uc2` | width/height CONFIRMED; pixels not claimed pixel-perfect | text drawing will not match device |

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

**commit:** Support in-memory mkdir and confirmed strcpy2 ABI

## Current blocker

```text
table[35]  mr_getUserInfo(info*)
PC=0x0001008c  LR=0x01ea5dcf  R0=0x002046a0
category   PLATFORM
```

`mr_userinfo` 布局 CONFIRMED（IMEI16+IMSI16+manu8+type8+ver u32+spare12）。填表应走 flymrp `DeviceProfile`，标 rxgj FULL / flymrp profile，不要假装真机 IMEI。
