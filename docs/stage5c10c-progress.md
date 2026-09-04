# Stage 5-C.10C：Minimal table[38] Implementation + Real MRP Re-run

状态：**COMPLETE**（只实现 `mr_platEx` **code 0x4c6**）。**未实现 table[33] / 其它 platEx code。Stage 5-D NOT STARTED。**

This is rxgj FULL compatibility behavior for the observed
`mr_platEx(0x4c6, NULL, 0, NULL, NULL, NULL)` call.

It is not claimed to implement the complete `mr_platEx` API
or universal Mythroad platform behavior.

`0x4c6 == 1222 == MR_TURONBACKLIGHT` 只是数值对应。本阶段**没有**背光状态、screen wake、DOM、Canvas、platform event 或任何其它副作用。

```text
REAL MRP BASELINE:
  deterministic: yes
  first production blocker: table[33]
  first post-130 blocker: table[33]
```

---

## Q&A

| | |
|---|---|
| **Q1** table38 / code 0x4c6 是否已经实现？ | **是。** `mr_table[38]` → `mr_platEx`；`code==0x4c6` 返回 `MR_SUCCESS`（0，rxgj `mr.h`） |
| **Q2** 是否严格只支持当前已确认 case？ | **是。** 其它 code → `UnknownAbiError` `unsupported mr_platEx code N`（family=`mr_platEx`）。无 default return 0 / SUCCESS |
| **Q3** table38 是否 REAL_EXECUTED？ | **是。** 生产路径 guest BLX + host handler 返回，不是 FORENSIC_BYPASSED |
| **Q4** 是否有任何副作用？ | **无。** 不写内存、不改 backlight/DOM/Canvas、不发事件 |
| **Q5** table38 返回值是否被 guest 使用？ | **否。** LIVE：`hit.return=0`，下一 slot 入口 `r0=0x00010084`（stub）。`table38 return consumer: none / overwritten before use` |
| **Q6** 真实 app 是否越过 table38？ | **是。** 38 = `REAL_EXECUTED`，随后到达 table[33] |
| **Q7** 新的 first production blocker 是什么？ | **table[33]** |
| **Q8** table33 是否 LIVE 到达？ | **是。** guest BLX 到 stub `0x00010084`，host 无 handler，`NOT_EXECUTED by host` |
| **Q9** 新 production mr_table 序列是什么？ | `25, 0, 125, 25, 0, 14, 130, 14, 38, 33`（LIVE，不是静态拼接） |
| **Q10** 5 次启动是否 deterministic？ | **是。** first blocker / PC / P / helper / ER_RW / rwLen / 序列 / ARM 145 / Lua 71 / native 序列全部相同 |
| **Q11** 是否添加 forensic bypass？ | **否。** 无 `cbRet` 越过 38/33 |

静态预测（C-9）与 LIVE 一致：38 返回后无条件到达 table[33]。未改执行路径。

---

## 实现

```text
mr_platEx(code, input, input_len, output, output_len, cb)
AAPCS: R0 R1 R2 R3 [SP+0] [SP+4]

code == 0x4c6  → return MR_SUCCESS   // 0；rxgj FULL dsm.c；no side effects
else           → UnknownAbiError     // family=mr_platEx
```

代码：`src/mythroad/mr-table.ts` `platEx`。inventory 只加 `mr_table/38/0x4c6`，不是整表 platEx。

`table[38] registered` ≠ `mr_platEx fully supported`。

禁止项（本阶段均未做）：table[33] / `asm_mr_getTime` / 其它 platEx code / 背光模拟 / Canvas / DrawText / DOM / audio / network / fake default SUCCESS / 新 forensic bypass。

---

## 真实启动链（LIVE，无 bypass）

```text
app.mrp → start.mr → 601/800/801(1)/800/801(6)/801(0)
  → table[130] REAL_EXECUTED  R1=7 R2=0x270f → R0=0x270f
  → ER_RW+0x1c = 0x270d
  → table[14] REAL_EXECUTED  memset(ER_RW+0x1940, 0, 0x78)
  → table[38] REAL_EXECUTED  mr_platEx(0x4c6, NULL, 0, NULL, NULL, NULL) → R0=0
  → table[33] STOP  NOT_EXECUTED by host
```

mr_table 生产调用序：

```text
25, 0, 125, 25, 0, 14, 130, 14, 38, 33
```

（10B 基线停在 38：`25, 0, 125, 25, 0, 14, 130, 14, 38`）

---

## table[38] LIVE

| | |
|---|---|
| status | REAL_EXECUTED |
| PC | `0x00010098` |
| R0–R3 | `0x4c6`, `0`, `0`, `0` |
| [SP+0] / [SP+4] | `0`, `0` |
| LR | `0x01ea666d` |
| return | `MR_SUCCESS` = 0 |
| consumer | none / overwritten before use |

---

## STOP @ table[33]

| | |
|---|---|
| identity | `asm_mr_getTime` = `mr_getTime`（源码；本阶段不实现） |
| status | BLOCKED / NOT_EXECUTED by host |
| PC / stub | `0x00010084` |
| caller PC / LR | `0x01ea7cf7`（`0x01ea7cf4` BLX 之后） |
| CPSR | `0x00000010` |
| R0–R3 | `0x00010084`, `0`, `0`, `0` |
| R4–R8 | `0`, `0x002057d0`, `0x00200100`, `0x0020021c`, `0` |
| R9 | `0x0020021c` |
| SP | `0x01e7ffa0` |
| stack | `0x0020021c`, `0x01ea7f7b`, `0x01e9cf63`, `0x01e7ffb0`（saved；`mr_getTime(void)` 无栈参数） |
| P | `0x00200100` |
| ER_RW | `0x0020021c` |
| owner | `gssjxz.mrp` |
| ARM insnCount | 145 |
| Lua insnCount | 71 |
| wrapper | `0x01ea7ce8` → `[mr_table+0x84]` → stub |

---

## Progress（LIVE）

```text
Stage              Status
--------------------------------
MRP parse           PASS
start.mr            PASS
mrc_loader.ext      PASS
cfunction.ext       PASS
cfunction init      PASS
code6               PASS
code0 entry         PASS
table130            PASS / REAL_EXECUTED
table14 post-130    PASS / REAL_EXECUTED
table38             PASS / REAL_EXECUTED
table33             BLOCKED
```

---

## 确定性

5 次真实启动：

```text
first production blocker = table[33]
PC = 0x00010084
P = 0x00200100
helper = 0x01ea5e9d
ER_RW = 0x0020021c
rwLen = 19952
mr_table sequence = 25, 0, 125, 25, 0, 14, 130, 14, 38, 33
ARM instruction count = 145
Lua instruction count = 71
native sequence = identical
```

deterministic: **yes**

---

## Stage 5-D

**NOT STARTED。**
