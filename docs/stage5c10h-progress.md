# Stage 5-C.10H：table[40] / mr_open ABI + filename provenance Forensics

状态：**COMPLETE**（只取证，**未实现** `table[40]`）。**Stage 5-D NOT STARTED。**

```text
table130  PASS / REAL_EXECUTED
table38   PASS / REAL_EXECUTED
table33   PASS / REAL_EXECUTED
table17   PASS / REAL_EXECUTED
table40   BLOCKED / LIVE REACHED

first production blocker = table[40]
```

禁止项（本阶段均未做）：实现 `table[40]`、把 empty filename 换成 `res_lang0.rc`、把 R6 当 filename、file fallback、host fs、IndexedDB、相邻 file slots、forensic bypass、改 table[17]、Stage 5-D。

---

## 核心结论

LIVE `mr_open` 的 R0 是空 C 串，因为 guest `_mr_readFile` 打开的是 **`pack_filename`（`table[100]`）**，不是 sprintf 得到的 `"res_lang0.rc"`。

```text
sprintf "res_lang0.rc"  →  R6 = 资源名（稍后拿去和 MRP 目录 strcmp）
table[100] pack_filename → R5/R0 = 要打开的 pack 路径
                          当前 = ""（从未写入）
                          → mr_open("", MR_FILE_RDONLY)
```

这是 **情况 B**：空 filename 是 producer 缺失，不是 `mr_open` 缺失败语义。下一阶段应先修 `table[100]` / `pack_filename`（128 字节，对齐 rxgj `arm_ext_set_pack_table_name`），**不要**实现 table[40]。

---

## Q1. table40 identity / signature

```text
slot:
40

identity:
CONFIRMED  asm_mr_open / mr_open

real symbol:
mr_open   (fixR9.h: #define asm_mr_open mr_open)

signature:
CONFIRMED  int32 mr_open(const char *filename, uint32 mode);
```

源码：

- `mythroad.c:479` `_mr_c_function_table[40] = (void*)asm_mr_open;`
- `mrporting.h` `extern int32 mr_open(const char* filename, uint32 mode);`
- Android 头文件写成 `MR_FILE_HANDLE`，`MR_FILE_HANDLE` 即 `int32`

mode 常量（`mrporting.h` / `mrc_base.h`，**不是 POSIX**）：

```text
MR_FILE_RDONLY    1
MR_FILE_WRONLY    2
MR_FILE_RDWR      4
MR_FILE_CREATE    8
MR_FILE_SHARD     16
MR_FILE_RECREATE  16   // 与 SHARD 同值
MR_FILE_COMMITTED 32
```

LIVE `R1=1` = `MR_FILE_RDONLY` **CONFIRMED**。

---

## Q2. storage namespace / backend

`mr_open` 打开的是 **宿主文件系统路径**（DSM `get_filename` 规范化后 `dsmInFuncs->open` / `file_lib.c my_open`）。

rxgj EXT 桥 `aex_t040` 额外：host `mr_open` 返回 0 且 MRP cache 非空时，按 **open 名字** 做 `mrp_cache_find` → `mrp_vfd_open`。这是 **pack 内资源的 VFD fallback**，不是默认路径。`mrp_cache_find("")` 立即 `NULL`。

`_mr_readFile`（`table[125]` = `asm_mr_readFile`）读的是 **当前 pack 的内部资源**（`*` m0 / `$` ram / 否则先 `mr_open(pack_filename)` 再解析 MRP 目录）。

```text
_mr_readFile:
  reads MRP pack namespace (m0 / ram file / opened pack index)

mr_open:
  opens host filesystem path (plus optional EXT MRP-cache VFD)
```

不要把 table40 直接接到现有 archive resource lookup。LIVE 这次要打开的是 **pack 容器文件名**，不是 `res_lang0.rc`。

`res_lang0.rc` 本身：当前 fixture archive **CONFIRMED 存在**。它是 **MRP archive 内资源**。本次 `mr_open` 并没有以它为 filename。

---

## Q3. mode=1

**CONFIRMED** `MR_FILE_RDONLY`。不是 POSIX `O_RDONLY=0`。

`file_lib.c my_open`：`mode & MR_FILE_RDONLY` → `O_RDONLY`。

---

## Q4. success / failure return ABI

rxgj `file_lib.c`：

```text
success: 正整数 handle（filef_count++，RB tree 映射宿主 fd）
failure: 0
```

注释：`mrc_open需要返回0表示失败`。

**不是** libc fd，**不是** `FILE*`，**不是** `MR_FAILED=-1`。`_mr_readFile` 也是 `if (f == 0)`。

`dsm.c mr_open`：`ret > 0` 才 `dsm_mrp_track_open`。

Android JNI 另一套 backend 把 `FILE*` 转成整数；本仓库对照的是 desktop `dsm.c` + `file_lib.c`。

---

## Q5–Q7. 谁分配了 0x00200058？有没有写？

```text
who allocated 0x00200058?
  CONFIRMED  ExtRuntime.initTable → DATA_SLOT 100 → allocU32(0)
  不是 table[0] mr_malloc

requested size:
  CONFIRMED  4，align8 → 8 字节
  真机 pack_filename[MR_MAX_FILENAME_SIZE] = 128

when:
  CONFIRMED  ExtRuntime 构造，guest 启动前

who initialized it:
  CONFIRMED  write32(addr, 0)；其余对齐字节来自 GuestMemory 零页

was it ever written (bindExt 之后到 table40):
  CONFIRMED  writes = []  allocated but never populated

why still zero:
  CONFIRMED  flymrp 没有 arm_ext_set_pack_table_name
```

LIVE `mrAllocs`：`8@0x00200230`、`220596@0x00200238`、`19956@0x00200218`。没有 `0x00200058`。

`heapExpected = EXT_HEAP_ADDR + 11*8 = 0x00200058` **CONFIRMED**（DATA_SLOT 100 是第 12 个 data slot，index 11）。

`ER_RW+0x190 = 0`。R0 来自 **`mr_table[100]` 指针值**，不是 ER_RW 副本。

---

## Q8. 为什么 R0 是空 C string？

**CONFIRMED** `table[100]` 指向的 8 字节全 0，guest 把它当 `pack_filename` 传给 `mr_open`。

不是 sprintf 失败，不是 strcpy 跳过，不是 VFS 缺资源后的清空。

---

## Q9. `"res_lang0.rc"` 与 `0x00200058` 的数据流

**CONFIRMED 没有复制关系。**

```text
0x01e9a882  sprintf return  buffer="res_lang0.rc"
0x01ea8cdc  guest _mr_readFile(lookfor=0, filename=R1)
            MOV r6, r1          ; R6 保存资源名
0x01ea8cfc  r2=mr_table  r1=table+0x180
            LDR r5,[r1,#0x10]   ; r5 = table[100] = 0x00200058
            LDRB [r5]  不是 '*' (0x2a) / '$' (0x24)
0x01ea8e8e  MOVS r1,#1 ; MOV r0,r5 ; BL wrap
0x000100a0  table[40]  mr_open("", RDONLY)
```

R6 用途：资源名，留给打开 pack 成功后和 MRP index `strcmp`。  
R0 用途：pack 路径。

---

## Q10. VFS 缺少 `res_lang0.rc` 是否导致空 filename？

**CONFIRMED 否。**

Archive / VFS **都有** `res_lang0.rc`。空 filename **不是** `lookup("res_lang0.rc") missing → mr_open("")`。

sprintf 之后 **没有** `table[125]`。Guest 自己跑 `_mr_readFile`，先 `mr_open(pack_filename)`。

table40 的空 filename **不是**“资源不存在”后的正常失败/fallback。

---

## Q11. guest 如何消费返回值？

返回点 `0x01ea8e96`（Thumb）：

```text
ADDS r5, r0, #0     ; Z = (fd == 0)
BNE  成功（继续读 MRP 头）
LDR  r1, error...   ; fd==0 失败路径
```

**CONFIRMED** 当前 init **期待** `mr_open(pack_filename)` **成功**（fd ≠ 0），以便解析 `res_lang0.rc`。  
**不是**期待 `open("")` 失败后走 happy fallback。

---

## Q12. rxgj `mr_open("", RDONLY)`（只源码）

```text
get_filename(""):
  isHostAbsolutePath("") = 0
  isDsmRootPath("") = 0
  → sprintf("%s%s", dsmWorkPath, "")
  dsmWorkPath 默认 MYTHROAD_PATH = "mythroad/"
  → "mythroad/"                         CONFIRMED

my_open("mythroad/", O_RDONLY):
  宿主 open 失败 → return 0              CONFIRMED
  Unix 上 open 目录可能成功 → 正 handle  HOST-DEPENDENT

aex_t040 empty name:
  arm_ext_pack_to_host_path 原样返回 empty
  mrp_cache_find("") → NULL
  无 VFD fallback                       CONFIRMED

side effects on failure:
  不分配 handle，无独立 errno 字段      CONFIRMED
```

这与本次 guest 意图（打开当前 pack 文件）不是同一语义。

---

## Q13. pack 内 table40 callsite / mode

直接 `GOT lit 0xa0`：**0**。  
`ADD r2,#0x80; LDR [r2,#0x20]; BLX r2`：**1**（就是 wrap `0x01ea89e0`）。

BL → wrap `0x01ea89d8`：**31 STATIC，其中 1 LIVE**（`0x01ea8e92`）。

LIVE mode：**CONFIRMED 1** `MR_FILE_RDONLY`。

STATIC 近邻 `MOVS r1,#imm`（INFERRED，未 LIVE）：

```text
1   RDONLY
2   WRONLY
4   RDWR
0xa WRONLY|CREATE
0xc RDWR|CREATE
```

STATIC PIC filename **CONFIRMED 存在非空路径**（本次未执行）：

```text
gssjxz\game.sav
gssjxz\pay.sav
gssjxz\status.sav
gsidbak/today.pay
gmtchn.cfg
```

未来 table40 不能假设永远是 empty / 永远 RDONLY。

---

## Q14. 相邻 file API slots（mythroad.c，只 inventory）

```text
slot 39 = mr_ferrno
slot 40 = asm_mr_open / mr_open
slot 41 = asm_mr_close / mr_close
slot 42 = asm_mr_info / mr_info      // 不是 read
slot 43 = asm_mr_write / mr_write
slot 44 = asm_mr_read / mr_read
slot 45 = asm_mr_seek / mr_seek
slot 46 = asm_mr_getLen / mr_getLen
slot 47 = asm_mr_remove / mr_remove
slot 48 = asm_mr_rename / mr_rename
slot 49 = asm_mr_mkDir / mr_mkDir
slot 50 = asm_mr_rmDir / mr_rmDir
slot 51 = asm_mr_findStart / mr_findStart
slot 52 = asm_mr_findGetNext / mr_findGetNext
slot 53 = asm_mr_findStop / mr_findStop
```

**42 = info，44 = read**。不能按 POSIX 顺序猜。本阶段不实现。

---

## Q15. flymrp 现有 VFS 能否直接表达 mr_open？

**CONFIRMED 不能直接表达本次 LIVE 语义。**

现有 `MythroadVfs`：ROM archive 成员 + RAM overlay，VFD 1–32。`open(name)` 按 **包内文件名** 查找。Lua `file.open` 走同一层。

- `vfs.exists("res_lang0.rc")` = true，但 LIVE 并没有把这个名字传给 table40
- `vfs.exists("")` = false；无 CREATE 时 `open` 返回 0
- `vfs.open("gssjxz.mrp")` 会在 **archive 内部** 找该名，不会打开 pack 容器本身
- 无 IndexedDB
- 无宿主路径 / pack alias 映射（rxgj `arm_ext_pack_to_host_path`）

有 `open()` 这个名字 ≠ `mr_open(pack_filename)`。

---

## Q16. 当前是否有足够证据做最小 table40 implementation？

**CONFIRMED 没有。情况 B。**

不要做：

```text
if filename == "": filename = lastSprintfBuffer
```

也不要只实现 `open("") → 0` 当生产路径：guest 这条路径 **期待成功**。

---

## Q17. 实现前真正应该修哪个 producer / ABI？

**CONFIRMED `table[100]` / `pack_filename`。**

rxgj：`_mr_c_function_table[100] = pack_filename`（128 字节）。启动时 `arm_ext_set_pack_table_name` 写入当前 pack 别名。flymrp `DATA_SLOTS` 含 100，但只 `allocU32(0)`（8 字节且空串）。

修好 pack 名之后，table40 仍需要统一 file ABI（成功正 handle、失败 0；host 路径 vs archive vs VFD）。那是 **producer 修好之后** 的设计，不是现在的 hack。

---

## Q&A 总表

| | 结论 | 证据 |
|---|---|---|
| **Q1** identity/signature | **CONFIRMED** `int32 mr_open(const char*, uint32)` | mythroad.c / mrporting.h / fixR9.h |
| **Q2** namespace | **CONFIRMED** host FS（EXT 可选 MRP-cache VFD） | dsm.c / aex_t040 |
| **Q3** mode=1 | **CONFIRMED** `MR_FILE_RDONLY` | mrporting.h + LIVE R1 |
| **Q4** return | **CONFIRMED** 成功 `>0` handle，失败 `0` | file_lib.c / _mr_readFile |
| **Q5** who alloc 0x00200058 | **CONFIRMED** DATA_SLOT 100 `allocU32(0)` | initTableMemory |
| **Q6** size | **CONFIRMED** 8（真机 128） | alloc(4) align8 vs `MR_MAX_FILENAME_SIZE` |
| **Q7** writes | **CONFIRMED** 无 guest store | onWrite range empty |
| **Q8** empty R0 | **CONFIRMED** pack_filename 从未填充 | table[100] 全 0 |
| **Q9** R6 vs R0 | **CONFIRMED** 资源名 vs pack 路径，无 strcpy | helper CFG |
| **Q10** missing resource? | **CONFIRMED 否** | archive 有 `res_lang0.rc` |
| **Q11** consumer | **CONFIRMED** `fd==0` 失败；期待成功 | `0x01ea8e96` ADDS/BNE |
| **Q12** `open("",RD)` | **CONFIRMED** 变成 `mythroad/`；成败 HOST-DEPENDENT | get_filename / my_open |
| **Q13** callsites | **CONFIRMED** 31 wrap BL；LIVE mode 1；STATIC 另有非空 PIC | cfunction.ext |
| **Q14** nearby slots | **CONFIRMED** 39–53 如上；42=info 44=read | mythroad.c |
| **Q15** existing VFS | **CONFIRMED** 不能表达 pack 容器 open | vfs.ts |
| **Q16** implement 40? | **CONFIRMED 否** 情况 B | 本文件 |
| **Q17** fix first | **CONFIRMED** table[100] pack_filename producer | arm_ext_set_pack_table_name |

---

## 生产路径（无 bypass）

```text
app.mrp → start.mr → … → table[17] sprintf REAL_EXECUTED
  → guest _mr_readFile("res_lang0.rc", lookfor=0)
  → mr_open(pack_filename="") 
  → STOP UNKNOWN_REQUIRED_SLOT = 40
```

`mr_table` 仍为：`25, 0, 125, 25, 0, 14, 130, 14, 38, 33, 17, 40`

---

## 工具

```bash
npx tsx tools/real/forensics-40.ts test/fixtures/real/app.mrp
```

只读取证。不注册 table[40]。不写 `pack_filename`。
