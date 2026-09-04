# Stage 5-C.10L：table[3] memcpy ABI Forensics + Directory Loop Continuation

状态：**COMPLETE**（只取证，未实现任何新 slot）。**未实现** table[3] / [10] / [1]。**未改** `CurrentPackFileBackend` / `mr_open` / `mr_read` / `mr_seek` / `mr_close`。**Stage 5-D NOT STARTED。**

```text
table130  PASS / REAL_EXECUTED
table38   PASS / REAL_EXECUTED
table33   PASS / REAL_EXECUTED
table17   PASS / REAL_EXECUTED
table100  PASS / DATA SLOT
table40   PASS / REAL_EXECUTED
table44   PASS / REAL_EXECUTED
table45   PASS / REAL_EXECUTED
table41   NOT REACHED
table3    BLOCKED / LIVE REACHED

first production blocker:
  table[3]

production mr_table:
  25, 0, 125, 25, 0, 14, 130, 14, 38, 33, 17,
  40, 14, 44, 0, 45, 44, 0, 3
```

---

## Q1–Q16

| Q | 答案 | 标签 |
|---|---|---|
| **Q1** table3 identity/signature | `_mr_c_function_table[3] = memcpy2`。`void *memcpy2(void *dest, const void *src, size_t count)`。AAPCS：R0=dst R1=src R2=count。实现：`rxgj src/mythroad/string.c`（Linux `lib/string.c` 拷贝）。宏 `MEMCPY` → `memcpy2`。**不是** `asm_…` wrapper，**不是** libc `memcpy` 符号 | **CONFIRMED** |
| **Q2** libc memcpy 还是自定义 | 自定义 `memcpy2`：`while (count--) *tmp++ = *s++; return dest;` 前向逐 byte。`memmove2` 在 **table[4]**，禁止把 3 实现成 memmove | **CONFIRMED** |
| **Q3** 返回值 | C / `memcpy2` / `aex_t003` 均写回 **R0 = dest** | **CONFIRMED** |
| **Q4** overlap 语义 | `memcpy2` **不处理** overlap（前向 copy，dst>src 会损坏）。overlap-safe 是 table[4] `memmove2`。rxgj `arm_ext_guest_memcpy` 重叠时仍前向逐 byte，非 memmove | **CONFIRMED** |
| **Q5** LIVE R0/R1/R2 | R0=`0x01e7ff34` dst；R1=`0x00205864` src；R2=`4`。R3=stub `0x0001000c`。见下方 LIVE 现场 | **CONFIRMED** |
| **Q6** 4 bytes 内容/含义 | LE **9**（`09 00 00 00`）。等于 `archive.data[240:244]`，即 directory 第一项 **filename 长度（含 NUL）**。guest 返回后 `LDR r2, [sp,#0x2c]` 当 `len` 用：`pos+=4`，校验 `(pos+len)>indexlen`、`len<1`、`len>=0x80` | **CONFIRMED** |
| **Q7** 当前 overlap | dst `[0x01e7ff34,0x01e7ff38)` ∩ src `[0x00205864,0x00205868)` = ∅。**overlap = no** | **CONFIRMED** |
| **Q8** guest 用返回值吗 | **否。** `return consumer = none`。BLX 下一指令是 `LDR r0, [sp,#8]`（pos），立即覆盖 R0 | **CONFIRMED** |
| **Q9** pack 内 table3 callsite | 紧扫描（`LDR [Rn,#0x38]` 后无 ADD 再 `LDR [Rt,#0x0c]; BLX`）：整 pack **13** 处，其中 `_mr_readFile` **9** 处。无 GOT 字面量 `0x0001000c`。LIVE 仅 `0x01ea8f52` | **CONFIRMED** |
| **Q10** GuestMemory 能否准确实现 | **能**，条件是未来用前向 `read8`/`write8` 循环。`load(slice())` 与 `TypedArray.set(subarray)` 在 overlap 上是 memmove，**不能**用来实现 table3。现有 API：**有** `fill`/`load`/`slice`/`compare`，**无** guest→guest `copy()` | **CONFIRMED** |
| **Q11** count=0 + invalid pointer | `memcpy2`：`while (count--)` 不进循环，不访问指针，返回 dest。`aex_t003`：`arm_ptr_span(addr,0)` 因 `!need` 返回 NULL（仍 `arm_ptr` 查找，不解引用）；`if (r2 && …)` 跳过 copy；`ret=r0`。未来 flymrp：**count=0 不得 `read8`**，否则 unmapped 会 `MemoryFault`，与源码/bridge 不一致 | **CONFIRMED**（源码+bridge）；flymrp 现状若先校验会 fault = 实现时注意，本阶段不改 |
| **Q12** table3 后下一 slot | 本 callsite 返回后下一 **mr_table** 仍是 **table[3]**（拷 TempName，count=`len`），然后 **table[10]** `strcmp2`，命中后再 table[3] `file_pos`/`file_len`，最后才 **table[1]** `mr_free` | **CONFIRMED** |
| **Q13** table10 identity | `_mr_c_function_table[10] = strcmp2`。`int strcmp2(const char *cs, const char *ct)`。不等返回 -1/1，等返回 0。LIVE 下一段：R0=filename `"res_lang0.rc"`（R6），R1=TempName（R7），返回值 **CMP #0** 使用 | **CONFIRMED** |
| **Q14** table1 identity | `_mr_c_function_table[1] = asm_mr_free` → `mr_free`。`void mr_free(void *p, uint32 len)`。NULL/越界/already-free：打印后 return。`aex_t001` 总是 `ret = MR_SUCCESS`。与 table[0]：本 pack malloc wrap 在块头存 size 并 `+4` 返回；free wrap `p-4`、`len+4` 再调 table[1]。flymrp table[0] 是 bump，`allocs[]` 不回收 | **CONFIRMED**（签名/wrap）；复用语义 **INFERRED** 为 red-eye 依赖池 |
| **Q15** 3/10/1 一起实现？ | **否。** 下一阶段只做 **table3 + table10**。table1 有 ownership / header 协议 / bump vs 池，拆 stage | **CONFIRMED**（判断） |
| **Q16** first blocker 仍 table3？ | **是。** 生产仍 `UNKNOWN_REQUIRED_SLOT = 3` | **CONFIRMED** |

建议下一阶段：

```text
Stage 5-C.10M
Implement confirmed core C ABI:
  table3  memcpy2
  table10 strcmp2
table1 remains a separate stage (allocator ownership).
```

---

## LIVE 现场（handler 未执行）

```text
stub PC     0x0001000c     table[3]
caller BLX  0x01ea8f52
return      0x01ea8f54     (LR 0x01ea8f55 Thumb)

R0 dst      0x01e7ff34     sp+0x2c  &len
R1 src      0x00205864     indexbuf[pos], pos=0
R2 count    4
R3          0x0001000c     stub
R4          0x01e7ffc8
R5          1              pack handle
R6          0x01e7ff74     "res_lang0.rc"
R7          0x00206de4     TempName user ptr
R8          0
R9 / ER_RW  0x00200294
SP          0x01e7ff08
LR          0x01ea8f55
CPSR        0x00000010
t-bit       0              (ARM stub)
insn        332
P           0x00200178
helper      0x01ea5e9d

src[0:4]    09 00 00 00    LE 9
src[4:13]   "start.mr\0"
dst[0:4]    未写（handler 未跑）
archive     data[240:244]  同 src[0:4]
overlap     no
```

index 分配：table[0] 实际收到 **5500**（`indexlen+4`），基址 `0x00205860`。malloc wrap `ADD r0,#4` 后 `STMIA r0!, {size}`，guest `indexbuf = 0x00205864`。`[sp,#0x10] = 0x1578` = indexlen 5496。**CONFIRMED** wrap 协议，不是 flymrp 私自 +4。

---

## 返回后 guest 指令（证明 4 bytes = len）

```text
1ea8f52  BLX r3                 table[3]
1ea8f54  LDR r0, [sp, #8]       pos；覆盖 memcpy 返回值
1ea8f56  LDR r2, [sp, #0x2c]    len ← 刚拷的 4 bytes
1ea8f58  ADD r0, #4             pos += 4
1ea8f5a  STR r0, [sp, #8]
1ea8f5c  LDR r1, [sp, #0x10]    indexlen
1ea8f5e  ADD r0, r2, r0         pos + len
1ea8f60  CMP r0, r1
1ea8f62  BHI error              越界 → close+free
1ea8f64  CMP r2, #1
1ea8f66  BLT error
1ea8f68  CMP r2, #0x80          MR_MAX_FILENAME_SIZE
1ea8f6a  BLT 1ea8f88            合法：拷文件名
```

对应 `mythroad.c` `_mr_readFile` EFS：

```c
MEMCPY(&len, &indexbuf[pos], 4);
pos = pos + 4;
if (((len + pos) > indexlen) || (len < 1) || (len >= MR_MAX_FILENAME_SIZE))
```

不是 file offset / file length / file pos。

---

## Directory loop 静态后续（不实现）

```text
table3  memcpy(&len, indexbuf[pos], 4)          LIVE STOP
  ↓
guest: pos+=4; 校验 len
  ↓
table3  memcpy(TempName, indexbuf[pos], len)    0x01ea8f94
  ↓
STRB 0 at TempName[len]; pos += len
  ↓
table10 strcmp(filename, TempName)              0x01ea8fac
  ↓  CMP r0,#0
  ├─ 相等 + lookfor==1 → close + table1 free → return 1
  ├─ 相等 + lookfor==0 →
  │     table3 memcpy(&file_pos, 4)             0x01ea8fda
  │     table3 memcpy(&file_len, 4)             0x01ea8fec
  │     校验 file_pos+file_len
  └─ 不等 → pos += 12; 若 pos>=indexlen 则 close+free；否则回拷 len
  ↓ 命中后
table1  mr_free(indexbuf, indexlen)             BL 0x01ea7ab4
table0  mr_malloc(file_len)
table45 seek SET / table44 read / table41 close
```

本 pack EFS 路径 **没有** 在两次 memcpy 之间调 table[14] memset。源码有 `MEMSET(TempName,0,sizeof)`；guest 用 malloc(0x80) + 拷完后 `TempName[len]=0`。**CONFIRMED** 与 C 源码略有差别。

第一个 directory 项是 `"start.mr"`，查找名是 `"res_lang0.rc"` → 第一轮 strcmp 必不相等（实现 3+10 之后才会 LIVE 走到）。

---

## rxgj bridge

`aex_t003`（`aex_table.c`）：

```c
cpy_dst = arm_ptr_span(m, r0, r2);
cpy_src = arm_ptr_span(m, r1, r2);
if (r2 && cpy_dst && cpy_src)
    arm_ext_guest_memcpy(cpy_dst, cpy_src, r2);
ret = r0;
```

- 先 guest→host 翻译；不可映射则 skip copy，仍返回 dst。
- 合法路径调用 `arm_ext_guest_memcpy`：重叠前向 byte copy，不重叠才 host `memcpy`。
- GOT snapshot 修复：若 copy 覆盖 GOT 中的 bridge 指针则还原。flymrp 无此 GOT snapshot；当前 LIVE dst 在 **stack**，不涉及 GOT。**CONFIRMED** LIVE 不需要 GOT 修复；其它 callsite **UNKNOWN** 直到碰到。

`aex_t010`：`ret = strcmp(arm_str(m, r0), arm_str(m, r1))`。`arm_str` 未映射则返回 4 字节全零空串，不崩。

`aex_t001`：`arm_ext_app_mem_free(m, r0, r1); ret = MR_SUCCESS`。

---

## GuestMemory / JS overlap 陷阱

| 做法 | overlap dst=src+1 count=4 结果 |
|---|---|
| `memcpy2` 前向 | `[1,1,1,1,1,…]` |
| `TypedArray.set(subarray)` | `[1,1,2,3,4,…]`（CopyBuffer / memmove） |
| `mem.load(dst, mem.slice(src,n))` | 同 memmove（先拷出独立缓冲） |

本阶段测试已锁住该差异。未来 table3 **必须** 前向逐 byte，禁止 `set(subarray)` / `load(slice)`。

`count=0`：循环 0 次即可。不要为了 translate 指针而 `read8` 未映射地址。

unmapped + `count>0`：flymrp 现有路径是 `MemoryFault` → `ExtStopKind.Unmapped`。`aex_t003` 是 skip copy 仍返回 r0。这是 **bridge vs memcpy2** 差异（memcpy2 对坏指针是 UB）。本阶段 **不改代码** 去迁就。实现 table3 时再定：建议对齐 memcpy2 的访问循环（映射内正常；越界 fault），不要为了模仿 bridge 而吞掉所有坏指针。

---

## table[3] callsite 分类

扫描规则：`LDR Rt, [Rn, #0x38]` 后、对该寄存器 ADD/SUB 之前，`LDR Rd, [Rt, #0x0c]; BLX Rd`。排除 PIC wrap（先 `ADD #0x80/#0x1c0`）。

`_mr_readFile`（`0x01ea8cdc`–`0x01ea91c8`）9 处：

| BLX | 用途 | LIVE / STATIC |
|---|---|---|
| `0x01ea8d56` 等前 5 处 | 旧版 / 其它分支 directory | STATIC future |
| `0x01ea8f52` | EFS `&len` count=4 | **LIVE startup required** |
| `0x01ea8f94` | EFS TempName count=len | STATIC future（紧邻） |
| `0x01ea8fda` | EFS `&file_pos` | STATIC future（命中后） |
| `0x01ea8fec` | EFS `&file_len` | STATIC future（命中后） |

函数外还有若干 STATIC（`0x01ea5dcc` 等）。无独立 slot-3 PIC wrap；低槽用 inline `mr_table+12`。

table[10] 在 `_mr_readFile` 至少两处：EFS `0x01ea8fac`、旧路径 `0x01ea8dee`。返回值 **使用**（`CMP r0,#0`）。

table[1] 在 `_mr_readFile` 通过 `BL 0x01ea7ab4`（header-peeling wrap：`SUB r0,#4`；`len = [p]+4`），不是 inline `LDR #4`。wrap 内再 BLX table[1]。

---

## 为何不把 table1 并进 10M

1. `mr_free` 依赖 LG 空闲链表与 **精确 len**；非法/NULL 只打印返回。
2. 本 pack malloc/free wrap 在指针前后藏 4 字节 size（类似 `mr_mallocExt`）。table[1] 收到的是 **header 指针 + size+4**，与 table[0] bump 记录匹配，但 flymrp **没有** 回收。
3. 源码注释：红眼鬼剑依赖 free 后再 malloc 复用同一块。bump 不回收可能仍能靠堆增长过本轮 startup，但这是 **INFERRED**，ownership 未闭环。
4. table3/10 是纯内存/字符串，源码闭环，directory loop 紧邻必需。

---

## 禁止项（本阶段已遵守）

未实现 table3 / table10 / table1 / 其它新 slot。无 forensic bypass、无 memmove fallback、无 host libc workaround。未改 file backend。Stage 5-D **NOT STARTED**。

---

## 如何跑

```bash
npx tsx tools/real/forensics-3.ts test/fixtures/real/app.mrp
npx vitest run test/real/memcpy-3-forensics.test.ts
npm test
npx tsc --noEmit
```
