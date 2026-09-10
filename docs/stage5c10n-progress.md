# Stage 5-C.10N：table[1] / mr_free Ownership + Allocation Header Forensics

状态：**COMPLETE**（只取证，**未实现** table[1]）。未改 table[0]/[3]/[10]、file backend、bump allocator。无 no-op free / fake success / registry.delete。**Stage 5-D NOT STARTED。**

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
table3    PASS / REAL_EXECUTED
table10   PASS / REAL_EXECUTED
table1    BLOCKED / LIVE REACHED

first production blocker:
  table[1]
```

---

## Q1–Q17

| Q | 答案 | 标签 |
|---|---|---|
| **Q1** table1 C identity/signature | `_mr_c_function_table[1] = asm_mr_free`。`fixR9.h`：`#define asm_mr_free mr_free`。`void mr_free(void *p, uint32 len)`（`mem.h` / `mr_helper.h` `T_mr_free`）。**C 返回 void** | **CONFIRMED** |
| **Q2** guest-visible return ABI | `aex_t001`：`arm_ext_app_mem_free(m,r0,r1); ret = MR_SUCCESS`（0）。非法/NULL 路径 C 只打印 return，bridge **仍写 R0=0**。LIVE handler 未跑，`return consumer = none / not executed`。wrap 下一指令是 `POP {r7,pc}`，不 cmp R0 | **CONFIRMED**（源码+wrap）；LIVE 消费 **INFERRED** 为覆盖/忽略 |
| **Q3** TempName 来自哪次 table0 | 第四笔 table0：`request=132` `ret=0x00206de0` insn=318。同一 `mrc_malloc` wrap（LR=`0x01ea8929`）。前三笔：8 / 19956（ER_RW）/ 5500（index header `0x00205860`） | **CONFIRMED** |
| **Q4** p-4 header 谁写 | **guest wrap，不是 flymrp table0。** table0 返回后 `[ret]=0`；table1 时 `[header]=128`。wrap：`ADD r0,r4,#4` 调 table0，成功后 `STMIA r0!, {r4}` 写入原始请求 128 并 `r0+=4` 返回 payload | **CONFIRMED** |
| **Q5** header/payload/len 协议 | `mrc_malloc`/`mrc_free` = `mr_mallocExt`/`mr_freeExt`（`fixR9.c` / `mem.c`）。guest payload 请求 N；table0 收到 N+4；header 存 N；table1 收到 header 与 N+4。TempName：N=128，table0=132，header=128，table1 len=132。index：N=5496，table0=5500，payload=`0x00205864` | **CONFIRMED**（两笔 wrap，不是单笔 128/132 外推） |
| **Q6** 是否所有 table1 同一协议 | **readFile / LIVE：是**（14 处 `BL 0x01ea7ab4`，本笔 `0x01ea904e`）。整 pack 另有 inline `LDR #4; BLX`（含 wrap 自身 `0x01ea7ac4`）。源码层 `mr_free(p,len)` **不**剥 header。不能声称 libc 式任意 free 都走 +4 | **CONFIRMED**（wrap 族）；其它族 **STATIC** |
| **Q7** rxgj 是否依赖 caller len | **是。** `mr_free` 把 `len` 8 字节对齐后写入空闲结点，**不读内部 size**。`mr_freeExt` 才读 `[p-4]`。错误 len 会破坏 first-fit 链表 | **CONFIRMED** |
| **Q8** NULL / invalid / mismatch | `!len \|\| !p \|\| 越界`：打印 `mr_free invalid` 后 return。`p` 已在空闲链：打印 `already free` 后 return。aex 仍 `MR_SUCCESS`。mismatch：按错误 len 插入/合并 | **CONFIRMED**（源码）；LIVE 未构造这些输入 |
| **Q9** free 是否改 guest memory | **是。** 插入结点时把 `LG_mem_free_t {next,len}`（8 字节）写进块头。不清零、不 poison。C 语义下不应再读 freed 块 | **CONFIRMED**（源码）；本阶段未执行所以 LIVE 块仍是 `"res_lang0.rc"` |
| **Q10** TempName free 后是否再用 | **否。** 返回 `0x01ea9052` 立刻 `LDR r0,[sp,#0xc]`（indexbuf）再 `BL` free wrap。随后 `R7` 被下一笔 malloc 覆盖。当前 allocation lifetime ends here | **CONFIRMED** |
| **Q11** 当前 startup 是否依赖地址 reuse | **否。** 下一笔 malloc 是 `file_len=17174`（对齐 17176）≫ TempName 136 与 index 5504。first-fit 会跳过这两个洞 | **CONFIRMED**（尺寸+CFG） |
| **Q12** rxgj 会不会 first-fit 复用 TempName | 同 size 再 malloc：**会**（模型 fixture：malloc/free/malloc(132) 同一地址）。本路径下一笔不是同 size，**不会**复用 TempName。flymrp bump **永不**复用 | **CONFIRMED**（源码+模型）；本路径 reuse **CONFIRMED 不发生** |
| **Q13** live registry 是否够验证这笔 | **够验证这笔。** registry 记的是 **table0 原始返回 = header** `0x00206de0` size=132 aligned=136。table1 R0/R1 与之完全匹配。若有人只记 payload `0x00206de4` 会对不上 | **CONFIRMED** |
| **Q14** A / B / C 哪个最符合当前证据 | 本路径 **A 或 B 都能过 startup**（不依赖 reuse）。**推荐下一阶段 B**（校验 ownership + `MR_SUCCESS`，不回收），并标明兼容简化。C（真实 first-fit）是长期/红眼复用所需，成本高。A 无 ownership 检查。本阶段不实现 | **INFERRED**（推荐）；证据本身 **CONFIRMED** |
| **Q15** 是否足够下一阶段实现 table1 | **足够实现已文档化的 B（或 A）**。不足以在无标记的情况下声称完整 `origin_mem` 兼容。实现后立刻还有第二笔 table1（indexbuf），然后才是已实现的 0/45/44/41 | **CONFIRMED**（判断） |
| **Q16** 实现 table1 后静态下一链 | `table1 free(indexbuf)` → `table0 malloc(file_len)` `0x01ea90b8` → `table45 seek SET` `0x01ea90d0` → inline `table44 read` → `table41 close` `0x01ea9128`。lookfor/flag `CMP #5` 走旁路；当前 lookfor=0 走 payload | **CONFIRMED**（静态） |
| **Q17** first blocker 仍 table1？ | **是。** `UNKNOWN_REQUIRED_SLOT = 1`。5 次 fingerprint 相同。table41 仍 NOT REACHED | **CONFIRMED** |

---

## ABI 分层

```text
C:     void mr_free(void *p, uint32 len)
table: asm_mr_free = mr_free
aex:   R0=p  R1=len  →  always R0=MR_SUCCESS (0)
```

`mr_malloc` / `mr_free` 是同一 `origin_mem` first-fit 族（`mem.c`）。table[0] 与 table[1] **是同一 allocator**。flymrp table[0] 目前是 EXT bump + `allocs[]`，**不是** first-fit。

---

## Guest wrap 协议（本 pack）

`mrc_malloc` `0x01ea8918`：

```text
r4 = guest payload request N
table0(N+4) → raw
if raw==0: return 0
[raw] = N          ; STMIA r0!, {r4}
return raw+4       ; payload
```

`mrc_free` `0x01ea7ab4`：

```text
PUSH {r7,lr}
r0 = payload-4     ; header
r1 = [header]+4
BLX table[1]
POP {r7,pc}
```

LIVE：

```text
table0  132 @ 0x00206de0   headerAfterHandler=0
guest   writes 128
payload 0x00206de4         "res_lang0.rc\0"
table1  R0=0x00206de0  R1=132
registry  guestAddr=header size=132 aligned=136  MATCH
```

---

## LIVE 现场（handler 未执行）

```text
stub PC     0x00010004
LR          0x01ea7ac7     wrap BLX 0x01ea7ac4
caller BL   0x01ea904e
return      0x01ea9052     (saved LR 0x01ea9053)

R0          0x00206de0     header
R1          132
R5          1              pack handle
R6          0x01e7ff74     "res_lang0.rc"
R7          0x00206de4     TempName payload
SP          0x01e7ff00
[SP]        0x00206de4     saved r7
[SP+4]      0x01ea9053     wrap caller
[SP+12]     0x00001b99     file_pos=7065
insn        507
```

---

## 返回后静态 CFG

```text
1ea9052  LDR r0, [sp,#0xc]     indexbuf payload
1ea9054  BL  mrc_free          第二笔 table1
1ea9058  LDR r0, [sp,#0x60]
1ea905a  CMP r0, #5
1ea905c  BNE payload           当前 lookfor=0 → 走这里
…
1ea90b8  BL  mrc_malloc        table0 file_len
1ea90d0  BL  mr_seek           table45 SET
         inline mr_read        table44
1ea9128  BL  mr_close          table41
```

---

## Allocator 对照

| | rxgj `mem.c` | flymrp table[0] |
|---|---|---|
| 策略 | first-fit + 相邻合并 | EXT bump，8 对齐 |
| size | `realLGmemSize` = `(x+7)&~7` | 同对齐 |
| header | allocator **不写** | **不写** |
| free | 用 caller len 插回链表，写 8B metadata | **未实现** |
| 同 size reuse | **会** 返回同一地址 | **不会** |
| 本 startup | 下一笔 17174，不复用 132/5500 | bump 也能过（空间够） |

红眼“先 free 再让 readFile 复用”是 **另一应用** 的已知依赖（`aex_table.c` 注释）。本 fixture 当前路径不依赖。

---

## 候选（不实现）

```text
A  no-op + MR_SUCCESS     本路径够用；无 ownership
B  registry 校验 + 不复用  推荐下一阶段；标明简化
C  真实 first-fit         长期兼容；本路径非必需
```

禁止把 B 写成 `registry.delete` 却假装完整 `mr_free`。

---

## 禁止项（本阶段已遵守）

未实现 table[1]。无 fake success、无 free-list、无改 table0/bump、无 bypass、无改 table3/10/file backend。Stage 5-D **NOT STARTED**。

---

## 如何跑

```bash
npx tsx tools/real/forensics-1.ts test/fixtures/real/app.mrp
npx vitest run test/real/free-1-forensics.test.ts
npm test
npx tsc --noEmit
```
