# Stage 5-C.10E：Implement table[33] / mr_getTime + Real MRP Re-run

状态：**COMPLETE**（实现 `uint32 mr_getTime(void)`，接 `runtime.clock >>> 0`）。**未实现 table[17] / `sprintf_`。Stage 5-D NOT STARTED。**

```text
mr_getTime is backed by flymrp's deterministic runtime clock.
The ARM ABI exposes the low 32 bits as uint32 milliseconds.
It does not use JavaScript wall-clock time.
```

```text
REAL MRP BASELINE:
  deterministic: yes
  first production blocker: table[17]
  first post-130 blocker: table[17]
```

---

## Q&A

| | |
|---|---|
| **Q1** table33 是否实现？ | **是。** `mr_table[33]` → `asm_mr_getTime` → `mr_getTime` → `runtime.clock >>> 0` |
| **Q2** 实际时间源是否是 runtime.clock？ | **是。** `bindExt` 传入 `getClock: () => this.clock`。无第二层 host timestamp |
| **Q3** 是否完全没有 Date.now / performance.now？ | **是。** 未接 `Date.now` / `performance.now` / `hrtime` / `SDL_GetTicks` |
| **Q4** 返回单位和 uint32 wrap 是否有测试？ | **是。** 毫秒；`0 … 0xffffffff` 及 `0x100000000→0`、`0x100000001→1`。`0x80000000` 保持无符号，不是 `|0` 的负数 |
| **Q5** advance() 是否会 deterministic 地影响 getTime？ | **是。** `getTime()=0`；`advance(10)→10`；`advance(25)→35`。不依赖 wall-clock sleep |
| **Q6** table33 是否 REAL_EXECUTED？ | **是。** guest BLX + host handler 返回，不是 FORENSIC_BYPASSED |
| **Q7** LIVE 是否执行了 ER_RW+0x4358 store？ | **是。** 默认启动 store=0（clock=0）。毒化 `0xdeadbeef` 后被覆盖为 0，证明 STR 执行 |
| **Q8** store 的实际值是什么？ | 默认基线：**0**（`runtime.clock` 初值 0，未 advance）。独立测试 `advance(1234)` 后 store=**1234** |
| **Q9** 真实 app 是否越过 table33？ | **是。** 随后到达 table[17] |
| **Q10** 新 first production blocker 是什么？ | **table[17]** `sprintf_` |
| **Q11** 是否 LIVE 到达 0x01ea9254？ | **否。** 仍在 `0x01ea7f68` 内：getTime store 之后 `movs r0,#0x55`，再 BL `0x01e9a8d8` → table[17] |
| **Q12** 新 production mr_table sequence？ | `25, 0, 125, 25, 0, 14, 130, 14, 38, 33, 17` |
| **Q13** 5 次启动是否 deterministic？ | **是** |
| **Q14** 是否添加任何 forensic bypass？ | **否** |

---

## 实现

```ts
// MrTableBridge.getTime
return (hooks.getClock?.() ?? this.clock) >>> 0;

// MythroadRuntime.bindExt
getClock: () => this.clock
```

```c
uint32 mr_getTime(void);   // 零参数；忽略 incoming R0–R3 / stack
```

epoch：`MythroadRuntime.clock` 初值 **0**。guest 可观察语义是自 runtime start 起的 monotonic elapsed ms。没有再叠 `native_uptime_base` / `dsmStartTime`。

inventory：`mr_table/33/mr_getTime`（完整 zero-argument ABI）。

不是：system clock / wall clock / Date.now / real device uptime。

---

## 真实启动链（LIVE，无 bypass）

```text
app.mrp → start.mr → 601/800/801(1)/800/801(6)/801(0)
  → table[130] REAL_EXECUTED  R1=7 R2=0x270f → R0=0x270f
  → table[14] REAL_EXECUTED
  → table[38] REAL_EXECUTED  mr_platEx(0x4c6, …) → R0=0
  → table[33] REAL_EXECUTED  mr_getTime() → R0=0
  → 0x01ea92c8 STR [r9+0x4358] = 0
  → movs r0, #0x55
  → BL 0x01e9a8d8
  → table[17] STOP  NOT_EXECUTED by host   sprintf_
```

mr_table 生产调用序：

```text
25, 0, 125, 25, 0, 14, 130, 14, 38, 33, 17
```

---

## table[33] LIVE

| | |
|---|---|
| status | REAL_EXECUTED |
| PC / stub | `0x00010084` |
| return | `0`（`runtime.clock >>> 0`，未 advance） |
| store | `ER_RW+0x4358 = 0` |
| consumer | `0x01ea92c8` STR；随后 `movs r0,#0x55` |

毒化测试：在 handler 入口写 `0xdeadbeef`，跑过之后字段为 `0`。

---

## STOP @ table[17]

| | |
|---|---|
| identity | `sprintf_`（rxgj `mythroad.c`：`_mr_c_function_table[17] = sprintf_`） |
| C | `int sprintf_(char* buffer, const char* format, ...)` |
| status | BLOCKED / NOT_EXECUTED by host |
| PC / stub | `0x00010044` |
| LR | `0x01e9a883` |
| CPSR | `0x00000010` T=0 |
| R0 | `0x01e7ff74`（buffer，栈上） |
| R1 | `0x01eaf204` → `"res_lang%d.rc"` |
| R2 | `0`（`%d` 的 AAPCS 候选；本阶段不实现） |
| R3 | `0x00010044`（BLX 目标残留，不是参数） |
| R4–R8 | `0`, `0x01e7ff74`, `0x0020202c`, `0x0020021c`, `0` |
| R9 | `0x0020021c` |
| SP | `0x01e7ff68` |
| stack | `0x01ea7cf7`, `0`, `0`, `0x01e7ffa0` |
| P | `0x00200100` |
| ER_RW | `0x0020021c` |
| owner | `gssjxz.mrp` |
| ARM insnCount | 183 |
| Lua insnCount | 71 |

本阶段**不**实现 table[17]。

---

## 0x01ea9254

LIVE **未到达**。helper 第二段 BL 仍在 `0x01ea7f68` 返回之后；当前停在该函数内部对 `sprintf_` 的调用。

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
table33             PASS / REAL_EXECUTED
table17             BLOCKED
```

---

## 确定性

5 次真实启动（未 advance）：

```text
first production blocker = table[17]
PC = 0x00010044
P = 0x00200100
helper = 0x01ea5e9d
ER_RW = 0x0020021c
rwLen = 19952
mr_table sequence = 25, 0, 125, 25, 0, 14, 130, 14, 38, 33, 17
ARM instruction count = 183
Lua instruction count = 71
native sequence = identical
stored getTime = 0
```

deterministic: **yes**

---

## Stage 5-D

**NOT STARTED。**
