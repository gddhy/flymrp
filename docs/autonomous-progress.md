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
| 42 | mr_info | BLOCKED | LIVE `dbglog.txt` |
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
| current-pack RDONLY file | open/read/seek/close pack bytes | other names, write, EFS | `_mr_readFile` uses pack name | `dbglog.txt` / `game.sav` need a separate namespace |
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

**commit:** this change set

---

## Current blocker

```text
table[42]  mr_info("dbglog.txt")
PC=0x000100a8  LR=0x01ea7aaf  R0=0x01eb0884
category   FILE
```

`mr_info` 返回 `MR_IS_FILE=1` / `MR_IS_DIR=2` / `MR_IS_INVALID=8`。  
rxgj 明确：当前 MRP 内资源不是已安装 EFS，不能报 `MR_IS_FILE`。  
`dbglog.txt` 不在 pack 内，下一步按“无 writable EFS → `MR_IS_INVALID`”实现，并禁止把 archive member 报成已安装文件。
