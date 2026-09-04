# Stage 5-C API Evidence

扫描范围（rxgj，不以标准 Lua 5.x / 记忆为准）：

* `src/mythroad/mythroad.c`（FULL，`MR_VERSION=1968`）
* `src/mythroad/mythroad.h` / `include/mythroad.h`
* `src/mythroad/src/lib/mr_iolib_target.c`
* `src/mythroad/mythroad_mini.c`（仅对照，不作为 Lua 主路径）
* `src/mythroad/src/lib/mr_strlib.c` / `mr_tablib.c` / `mr_baselib.c`
* `src/mythroad/src/lib/unused/mr_mathlib.c`
* `src/mythroad/src/mr_vm.c` / `mr_do.c` / `mr_tm.c` / `mr_tm.h`
* `src/mythroad/mr_pluto.c`
* `src/mythroad/mr_base64.c`
* `src/mythroad/unused/start.mr.lua`（源码样例，**不是** binary `start.mr`）

工作区 **没有** 真实 `*.mr` / `*.mrp` / `*.jar` / `魔塔II.jar`。

`confidence`：只有 **CONFIRMED** 进入主实现。`INFERRED` 必须有 fixture。`UNKNOWN` 禁止猜。

---

## 1. Lua 标准库打开路径

| 字段 | 值 |
|---|---|
| source | `mythroad.c` `_mr_intra_start` |
| registration | `mrp_open_base` / `mrp_open_string` / `mrp_open_table` / `mrp_open_file` |
| 不打开 | `mrp_open_math`（仅 `unused/mr_mathlib.c` + unused `mr.c`） |
| confidence | CONFIRMED |

---

## 2. `__pow` / POW

| 字段 | 值 |
|---|---|
| source file | `src/mr_vm.c` `Arith` TM_POW；`src/mr_tm.c` `mr_T_init` |
| VM lookup | `mr_H_getstr(gt(L), tmname[TM_POW])`；非函数 → `err:1020` |
| tmname[TM_POW] | 活动代码为 `"__op"`（`mr_tm.c:61`）。注释掉的标准名才是 `"__pow"` |
| unused mathlib | `mrp_open_math` 把 `math_pow` 装到 **globals.`__pow`**，主路径不调用 |
| 默认安装 | **无**。主路径既不装 `__op` 也不装 `__pow` |
| 本实现 | POW 热路径仍是 lookup → function。接受 globals.`__op` **或** `__pow`（两处 CONFIRMED 名）。不改 POW opcode 语义，不默认装 mathlib |
| limitation | `^` 在真实 FULL 主路径上默认 `err:1020`，除非应用自己注册 |
| confidence | CONFIRMED（lookup / 错误码 / 未打开 mathlib）；安装位置 = 兼容性限制 |

---

## 3. Metamethod（`mr_tm.h` ORDER TM + `mr_vm.c`）

| name | source | 何时触发 | args | returns | EXT | gfx | timer | VFS | confidence |
|---|---|---|---|---|---|---|---|---|---|
| `__index` | `mr_V_gettable` / `mr_V_index` | 表 miss 或非表 | fn(t,key) 或继续 gettable | 1 | 否 | 否 | 否 | 否 | CONFIRMED |
| `__newindex` | `mr_V_settable` | raw 值为 nil 且存在 TM | fn(t,key,val) 或继续 settable | 0 | 否 | 否 | 否 | 否 | CONFIRMED |
| `__call` | `mr_do.c` `tryfuncTM` | CALL 目标非 function | 插入 TM 再调用 | 依函数 | 否 | 否 | 否 | 否 | CONFIRMED |
| `__add/sub/mul/div` | `Arith` + `call_binTM` | tonumber 失败 | fn(a,b) | 1 | 否 | 否 | 否 | 否 | CONFIRMED |
| `__unm` | `OP_UNM` | tonumber 失败 | fn(a, nil) | 1 | 否 | 否 | 否 | 否 | CONFIRMED |
| `__concat` | `mr_V_concat` | tostring 失败 | fn(a,b) | 1 | 否 | 否 | 否 | 否 | CONFIRMED |
| `__eq` | `mr_V_equalval` | 两 table 且两边 TM 相同 | fn(a,b) | truthy | 否 | 否 | 否 | 否 | CONFIRMED |
| `__lt` / `__le` | `lessthan` / `lessequal` | 非 number/string | 两边 TM 必须 rawequal | truthy | 否 | 否 | 否 | 否 | CONFIRMED |
| 循环上限 | `MAXTAGLOOP=100` | | | `table err:2014` / `2015` | | | | | CONFIRMED |

`mr_T_gettmbyobj`：仅 **table / userdata** 有 metatable；number/string 无类型元表。

GETGLOBAL miss → `mr_V_index`（globals 的 `__index`）。SETGLOBAL → `mr_V_settable`。SELF → 同 GETTABLE。

---

## 4. Integer / `mrp_Number = int`

| 字段 | 值 |
|---|---|
| source | `mr_user_number.h` USE_INT；`mr_vm.c` ADD/SUB/MUL/DIV 直接 `mrp_Number` 运算 |
| 本实现 | 热路径保持 `i32`（`n \| 0`） |
| 除零 | C 未定义；本实现 `LuaRuntimeError`（implementation-defined） |
| `INT_MIN / -1` | C UB；本实现 `i32` wrap（implementation-defined） |
| 负除法 | JS `/` 再 `\| 0` = 向零截断（C99；C89 implementation-defined） |
| 负取模 `_mod` / `%` | 符号跟随被除数（JS `%`；C89 implementation-defined） |
| 比较 | 有符号 32-bit |
| 位运算 | 非 number **静默 no-op**（已确认） |
| confidence | CONFIRMED（类型）；溢出/除零 = implementation-defined compatibility choice |

---

## 5. string library（`mr_strlib.c` `mrp_open_string`）

| registration | source fn | argc | returns | notes | confidence |
|---|---|---|---|---|---|
| `string.len` | `str_len` | 1 string | 1 number | 字节长度（含嵌入 0） | CONFIRMED |
| `string.clen` | `str_clen` | 1 | 1 number | `min(len, strlen)` | CONFIRMED |
| `string.wlen` | `str_wlen` | 1 | 1 number | `min(len, mr_wstrlen)` UTF-16LE 至 `0x0000` | CONFIRMED |
| `string.cstr` | `str_cstr` | 1 | 1 string | 截到第一个 NUL | CONFIRMED |
| `string.wstr` | `str_wstr` | 1 | 1 string | 截到第一个 UTF-16 NUL | CONFIRMED |
| `string.sub` | `str_sub` | s, i [, j=-1] | 1 string | 1-based；负索引从末尾 | CONFIRMED |
| `string.lower/upper` | `str_lower/upper` | 1 | 1 string | ASCII | CONFIRMED |
| `string.char` | `str_char` | n ints | 1 string | 每字节 `uchar(c)==c`（0..255） | CONFIRMED |
| `string.rep` | `str_rep` | s, n | 1 string | | CONFIRMED |
| `string.byte` | `str_byte` | s [, pos=1] | 0 或 1 number | **单位置**（非 Lua 5.1 范围） | CONFIRMED |
| `string.find` | `str_find` | s, p [, init=1 [, plain]] | nil 或 start,end | 无 special 或 plain→memfind | CONFIRMED |
| `string.pack` | `b_pack` | fmt, ... | 1 binary string | **不是** Lua 5.3 pack。`x bB hH lL iI c s`；`>`/`<`；默认 native LE | CONFIRMED |
| `string.unpack` | `b_unpack` | fmt, data [, pos=1] | values + nextpos | 1-based pos | CONFIRMED |
| `string.packLen` | `b_size` | fmt | 1 number | size 0 报错 | CONFIRMED |
| `string.subV` | `str_subV` | 1 string | **2**：`(uintptr_t)p`, `len` | 宿主无稳定 C 指针。本实现返回 `0, len` 并记录 limitation | CONFIRMED ABI / host limitation |
| `string.findEx` / `findex` | `gfind` | s, p | 1 closure | | CONFIRMED，本阶段未实现 |
| `string.subEx` / `subex` | `str_gsub` | | 2 | | CONFIRMED，本阶段未实现 |
| `string.format` / `dump` | | | | | CONFIRMED，本阶段未实现 |
| `string.c2u` / `u2c` | GB2312 | | | 需码表 | CONFIRMED，未实现（不猜码表完整性） |
| `string.new/set/update/pupdate` | 改 C 串缓冲 | | | intern 串不可变 | CONFIRMED，未实现 |

`start.mr.lua` 使用：`string.pack`、`string.sub`、`string.subV`。

---

## 6. table library（`mr_tablib.c`）

| registration | source | notes | confidence |
|---|---|---|---|
| `table.concat` | `str_concat` | `t [, sep="" [, i=1 [, j=getn]]]`；元素须 string/number | CONFIRMED |
| `table.getArrSize` / `getn` | `mr_B_getn` | `t.n` 若为 number≥0，否则 hidden sizes，否则数 1..n 至 nil | CONFIRMED |
| `table.setArrSize` / `setn` | `mr_B_setn` | 有 `t.n` 则写 `t.n`，否则 sizes[t] | CONFIRMED |
| `table.insert` / `remove` | | 用 getn/setn 移动数组 | CONFIRMED |
| `table.rawGet` / `rawSet` | | 不走 TM | CONFIRMED |
| `table.next` / `pairs` / `iPairs` | | | CONFIRMED |
| `table.save` / `load` | Pluto persist | 同 SaveTable 格式 | CONFIRMED |
| `table.sort` / `forEach` | | | CONFIRMED；sort 本阶段实现简单数组排序 |

---

## 7. base（`mr_baselib.c`）

| registration | source | args / returns | confidence |
|---|---|---|---|
| `_setTab` | `mr_B_setmetatable` | table, nil\|table → 1；`__metatable` 则 error | CONFIRMED |
| `_getTab` | `mr_B_getmetatable` | any → mt 或 `__metatable` 或 nil | CONFIRMED |
| `_num` / `tonumber` | `mr_B_tonumber` | | CONFIRMED |
| `_str` / `tostring` | `mr_B_tostring` | | CONFIRMED |
| `_next` / `next` | `mr_B_next` | | CONFIRMED |
| `type` / `_t` | | 长/短名 | CONFIRMED（5-B 已实现） |
| `coroutine.*` | `mrp_open_base` | create/wrap/resume/yield/status | CONFIRMED **ABI**；本 VM **无 thread**，不实现（不猜 yield） |

---

## 8. SaveTable / LoadTable

| 字段 | 值 |
|---|---|
| source | `mythroad.c:2734` / `:2766`；格式 `mr_pluto.c` |
| SaveTable | `(perms:table, root, filename)` → settop 2；open WRONLY\|CREATE 失败 **return 0**；成功 persist + `MR_SUCCESS`，return 1 |
| LoadTable | `(perms:table, filename)` → settop 2, pop；open 失败留下 perms，return 1；成功 unpersist，return 1 |
| 格式 | 每对象：`int firsttime`（0=ref / 1=first）；first→ `int ref` + `int type` + payload。nil = `0,0`。bool=`int`。number=`mrp_Number`（4 字节 LE）。string=`int len` + bytes。table：`int isspecial` + persist(mt) + k/v… + persist(nil) |
| PLUTO_TPERMANENT | 101 |
| 禁止 | `JSON.stringify` |
| 本实现 | 字面 nil/bool/number/string/table（含环、metatable）。function/userdata/thread **拒绝**（C 的 Lua closure persist 未移植） |
| EXT / gfx / timer | 否 / 否 / 否 |
| VFS | 是 |
| confidence | CONFIRMED |

---

## 9. `_runFile` / `RunFile` / RESTART

| 字段 | 值 |
|---|---|
| source | `mythroad.c:2968` `MRF_RunFile`；`mr_timer:4355` |
| args | `(pack, startfile, param)` 皆 tostring，缺省 0 指针 |
| returns | 0 |
| side effects | 写 `pack_filename` / `start_filename` / `start_fileparameter`；`mr_timer_p="restart"`；`MR_TIME_START(100)`；`mr_state=RESTART` |
| 不递归 | timer 见 RESTART：`mr_stop()` 然后 `_mr_intra_start(start_filename)` |
| pause@RESTART | 停 timer，`MR_SUCCESS` |
| resume@RESTART | `mr_timer_p="restart"`，`MR_TIME_START(100)` |
| pack 切换 | C 改 pack 名再 intra_start。本宿主无真实 FS；只跑 **当前 VFS** 里的 `startfile` |
| confidence | CONFIRMED |

---

## 10. `_strCom` 本阶段新增

| code | source | args | returns | side effects | EXT | VFS | confidence |
|---|---|---|---|---|---|---|---|
| 300 | `_mr_TestCom1` | bytes | 1 string 或 0 | gzip/unzip；非 gzip **原样返回** | 否 | 否 | CONFIRMED |
| 500 | | bytes | 1 string(16) | MD5 digest | 否 | 否 | CONFIRMED |
| 501 | `mr_base64.c` `_mr_encode` | bytes | 1 string 或 0 | **置换字母表** base64，不是标准 RFC | 否 | 否 | CONFIRMED |
| 502 | `_mr_decode` | bytes | 1 string 或 0 | 同上解码 | 否 | 否 | CONFIRMED |
| 2–6, 600, 603 | | | | host 指针 / m0 | | | CONFIRMED 存在，**不实现** |
| 700, 701, 900 | | | | SMS / platEx | | | P2，不实现 |

601/602/800/801/802：Stage 5-B，保持。

---

## 11. `_com`

5-B 已实现：1, 100, 101, 102, 400, 401, 403, 406, 3629。

| 未实现 | 原因 |
|---|---|
| 2–6 | native 函数指针 |
| 200–307 | shake / sms（P2） |
| 402 | socket（P2） |
| 其余 | UNKNOWN 或非 P0 |

---

## 12. Graphics command（仍 Null backend，不接 Canvas）

已有（5-B）：clear / rect / line / point / text / eff / flush。

| name | source | args | command op | confidence |
|---|---|---|---|---|
| `BitmapLoad` | `mythroad.c:1988` | i, file, x, y, w, h, max_w | `image` load；需 `bi & MR_FLAGS_BI` | CONFIRMED |
| `BitmapShow` | `:2067` | i, x, y [, rop, sx, sy, w, h] | `image` | CONFIRMED |
| `BitmapNew` | `:2111` | i, w, h | 分配槽（记录 state） | CONFIRMED |
| `BitmapDraw` | `:2139` | di,dx,dy,si,sx,sy,w,h,A,B,C,D,rop | `image` draw | CONFIRMED |
| `SpriteSet` | `:2207` | i, h | state | CONFIRMED |
| `SpriteDraw` | `:2219` | i, idx, x, y [, mod] | `sprite` | CONFIRMED |
| `TileSet` | `:2288` | i, x, y, w, h, tileh | state | CONFIRMED |
| `TileSetRect` | `:2324` | i, x1, y1, x2, y2 | state | CONFIRMED |
| `TileDraw` | `:2346` | i | `tile`（用已设 state） | CONFIRMED |
| `BitmapShowEx` | | 像素指针 | host 指针 | CONFIRMED，**不实现** |
| GUI / audio | | | | P1/P2，本阶段仅 command 记录已确认 draw |

`BITMAPMAX=30` `SPRITEMAX=10` `TILEMAX=3`。

---

## 13. `_plat` / `_platEx`

| 字段 | 值 |
|---|---|
| Lua | `MRF_plat(code, param)` → 1 number；`MRF_platEx(code, str)` → output, ret |
| 具体 code | `dsm.c` `mr_plat` / `mr_platEx` 分发；未逐码接到 Lua 测试 |
| confidence | 入口 CONFIRMED；**各 code 语义 UNKNOWN，禁止猜** |

---

## 14. Coroutine / closure / ownership

| 项 | 结论 | confidence |
|---|---|---|
| coroutine | base 注册 create/wrap/resume/yield/status；VM 无 thread | CONFIRMED 未实现 |
| closure / upvalue | 5-A 已有；对象活在 `LuaState` 数组（tables/closures/strings/upvals），不靠 JS GC 时机 | CONFIRMED |
| 打开 upvalue | 指向栈槽；`CLOSE`/`RETURN` 拷进 UpVal | CONFIRMED |

---

## 15. 真实 binary / 魔塔II

| 项 | 结果 |
|---|---|
| rxgj `*.mr` / `*.mrp` | 无 |
| flymrp 工作区 | `test/fixtures/real/app.mrp`（用户提供，未改原文件） |
| 身份 | SHA-256 `77487205…4263`，MRPG，`gssjxz.mrp`，蜀山剑侠传 |
| 启动 | 第一份 `start.mr`：`_mr_c_load==0`；cfunction load + `801` code 6 guest 返回 0 |
| 停点 | `UNKNOWN_REQUIRED_SLOT = 33`（`asm_mr_getTime` 未实现）；table[130] case 7 与 table[38] code 0x4c6 已接线 |
| `魔塔II.jar` | **工作区不存在**。未做 DRM。 |
| 结论 | **INSPECTED，不是 real-app green。** |

### table[14] memset2

| 字段 | 值 |
|---|---|
| source | `mythroad.c` `_mr_c_function_table[14] = memset2`；`string.c` `memset2` |
| ABI | `void *memset2(void *s, int c, size_t count)`：填 `c` 的低 8 位，返回 `s` |
| 真实调用 | `r0=0x0020021c` `r1=0` `r2=19952`（ER_RW） |
| confidence | CONFIRMED |

### table[130] asm_mr_TestCom（5-C.10B：仅 case 7）

| 字段 | 值 |
|---|---|
| source | `mythroad.c` `_mr_c_function_table[130] = asm_mr_TestCom`；`fixR9.h` `#define asm_mr_TestCom _mr_TestCom` |
| ABI | `_mr_TestCom(L, input0, input1)`；rxgj `aex_t130` 传 `(NULL, r1, r2)`。Guest r0/r3 忽略 |
| 实现 | **仅 case 7**：rxgj FULL `#ifdef MR_PLAT_DRAWTEXT` → `return input1`。其它 case → `UnknownAbiError`。不是 universal Mythroad，不是平台探测 |
| 真实调用 | `r1=7` `r2=0x270f` → `r0=0x270f` **REAL_EXECUTED** |
| ER_RW | 函数本身不写；guest 随后 `str` 使 **ER_RW+0x1c = 0x270d**（LIVE） |
| 后继 | table[14] memset → table[38] REAL_EXECUTED → table[33] STOP |
| confidence | case 7 CONFIRMED（rxgj FULL）。整表 TestCom **未**实现 |

### table[38] asm_mr_platEx（5-C.10C：仅 code 0x4c6）

| 字段 | 值 |
|---|---|
| source | `mythroad.c` `_mr_c_function_table[38] = asm_mr_platEx`；`fixR9.h` `#define asm_mr_platEx mr_platEx`。**无 `_mr_platEx` 符号** |
| ABI | `int32 mr_platEx(int32 code, uint8 *input, int32 input_len, uint8 **output, int32 *output_len, MR_PLAT_EX_CB *cb)` |
| 实现 | **仅 code 0x4c6**：rxgj FULL `return MR_SUCCESS`（0），无副作用。其它 code → `UnknownAbiError`。`table[38] registered` ≠ 完整 platEx。不是背光系统 |
| 真实调用 | `0x01ea666a` BLX r4；`r0=0x4c6` `r1=0` `r2=0` `r3=0` `[sp]=0` `[sp+4]=0` **REAL_EXECUTED** |
| 返回 | LIVE `r0=0`；guest 无 cmp/test；下一 BL `0x01ea7ce8` 覆盖 r0。table[33] 入口 `r0=0x00010084` |
| 后继 | table[33] `asm_mr_getTime` **STOP**（LIVE，host 未实现） |
| confidence | 本次 0x4c6 CONFIRMED（rxgj FULL）。整表 platEx **未**实现 |

### table[33] asm_mr_getTime（5-C.10C LIVE 到达，未实现）

| 字段 | 值 |
|---|---|
| source | `mythroad.c` `_mr_c_function_table[33] = asm_mr_getTime`；`fixR9.h` `#define asm_mr_getTime mr_getTime` |
| C | `uint32 mr_getTime(void)` |
| LIVE | stub `0x00010084`；入口 `r0=0x00010084`（BLX 目标，不是 platEx 返回值）；host **未**实现 |
| confidence | 到达 CONFIRMED。行为 **未**实现 |

---

## 16. 计数（证据条目）

本文件列出的独立 API / opcode 证据条目 ≥ 20。

| confidence | 约数 |
|---|---|
| CONFIRMED | 本阶段实现所依据的全部主路径 |
| INFERRED | 0（无） |
| UNKNOWN | `_plat*` 其它 code、`asm_mr_getTime`、未读完的 GUI/audio/network |

---

## 17. 明确不实现（本阶段）

Canvas / WebGL / WebGPU / WebAudio / DOM / setTimeout / IndexedDB / network / SMS / WAP / JIT / CPU·EXT rewrite / DRM / 猜测 UNKNOWN ABI / 默认安装 mathlib / `string.set` 可变缓冲 / coroutine thread / Pluto 持久化 Lua function。
