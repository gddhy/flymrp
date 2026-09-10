# Stage 5-C.10D：table[33] / asm_mr_getTime ABI Forensics

状态：**COMPLETE**（只取证）。**未实现 table[33] / `asm_mr_getTime`。Stage 5-D NOT STARTED。**

```text
READ-ONLY FORENSICS
first production blocker = table[33]
```

禁止项（本阶段均未做）：`table[33]` handler、`Date.now` / `performance.now` / `scheduler.now` / `runtime.now` 接线、假时间戳、常量 0、自增 fake tick、table[130]/[38] 新 case、forensic bypass。

---

## 1. Slot 33 源码身份

```text
slot:      33
identity:  CONFIRMED
real symbol: asm_mr_getTime → mr_getTime
C signature: uint32 mr_getTime(void);
```

源码（rxgj FULL，不要按函数名猜）：

- `mythroad.c`：`_mr_c_function_table[33] = (void*)asm_mr_getTime;`
- `fixR9.h`：`#define asm_mr_getTime mr_getTime`
- `fixR9.h`：`extern uint32 asm_mr_getTime(void);`
- `mrporting.h`：注释「取得时间，单位ms」+ `extern uint32 mr_getTime(void);`
- `mr_helper.h`：`typedef uint32 (*T_mr_getTime)(void);`
- MINI `mythroad_mini.c` 同样把 `[33]` 指到 `asm_mr_getTime`。实现不在 mini 表初始化里，在平台 `dsm.c`。

`aex_t033`：`ret = mr_getTime();` —— 零参数。compat 忙等 `usleep` 是宿主策略，不是 guest ABI。

---

## 2. `mr_getTime` 实现

| 项 | FULL 桌面 `src/mythroad/dsm.c` | Android JNI `dsm.c` |
|---|---|---|
| return type | `uint32` | `uint32` |
| time source | `dsmInFuncs->get_uptime_ms() - dsmStartTime` | `gettimeofday` 相对 `gEmuEnv.dsmStartTime` |
| unit | 毫秒 | 毫秒 |
| origin | DSM init（`dsm_init` 里记下 `dsmStartTime`） | emulator 记下的 `dsmStartTime` |
| type | monotonic elapsed（见下） | wall-based **相对** ms |
| wrap | `uint32` ≈ 49.7 天 | 同 |
| signed | 返回无符号；C 减法按模 2^32 | 同 |
| 全局状态 | `dsmStartTime` + 宿主 uptime 基准 | `gEmuEnv.dsmStartTime` |

FULL 桌面宿主链（**CONFIRMED**）：

```c
// dsm.c
uint32 mr_getTime(void) {
    return dsmInFuncs->get_uptime_ms() - dsmStartTime;
}
// dsm_init:
dsmStartTime = dsmInFuncs->get_uptime_ms();

// utils.c
int64_t get_uptime_ms(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (int64_t)ts.tv_sec * 1000 + (ts.tv_nsec / 1000000);
}

// native_dsm_funcs.c
native_get_uptime_ms = (uint32)((uint64_t)get_uptime_ms() - native_uptime_base);
// native_sleep: native_uptime_base -= ms;  // 虚拟快进，不 usleep
```

结论：

- **不是**秒、不是 tick 计数器、不是日历 wall clock。
- `SDL_GetTicks` **不是** `mr_getTime` 来源（只用于 UI toast / e2e）。
- `get_time_ms()` / `gettimeofday` 是另一条 wall 路径；FULL 桌面 **`mr_getTime` 不用它**。
- `mr_sleep` 通过回拨 `native_uptime_base` 让随后的 `mr_getTime` 前进，不冻结宿主主循环。

```text
milliseconds?              YES (CONFIRMED)
ticks?                     NO
seconds?                   NO
wall clock?                NO on FULL desktop; Android JNI is wall-based relative ms
monotonic elapsed time?    YES on FULL desktop (CLOCK_MONOTONIC minus start)
platform timer?            YES — platform callback get_uptime_ms
```

---

## 3. 真实 LIVE guest ABI（停在 stub）

无 `registerHandler(33)`、无 bypass。生产与 probe 均：

```text
UNKNOWN_REQUIRED_SLOT = 33
```

进入 stub 前：

```text
PC/stub = 0x00010084 = EXT_TABLE + 33*4
LR      = 0x01ea7cf7          // wrap 内 BLX 0x01ea7cf4 之后 |1
SP      = 0x01e7ffa0
R0-R3   = 0x00010084, 0, 0, 0
R4-R8   = 0, 0x002057d0, 0x00200100(P), 0x0020021c(ER_RW), 0
R9      = 0x0020021c
CPSR    = 0x10  T=0  insn=145
stack   = 0x0020021c, 0x01ea7f7b, 0x01e9cf63, 0x01e7ffb0
P       = 0x00200100
helper  = 0x01ea5e9d
ER_RW   = 0x0020021c
owner   = gssjxz.mrp
init2 0x01ea9254 = false
handlers 130/38/33 = true/true/false
```

零参数 ABI（**CONFIRMED**）：

- R0 是 BLX 目标（stub），不是 getTime 参数。
- R1–R3 是上一调用 platEx 的残留 0，不是参数。
- 栈上是 saved r7 / lr，不是 getTime 参数。

---

## 4. 本 init 调用点

```text
0x01ea7f68  (mrc_init 后继)
  BL 0x01eab1ac     table[14] memset
  movs r0, #0
  BL 0x01ea664c     table[38] platEx wrap
  BL 0x01ea7ce8     ★ table[33] wrap   ← 当前停在这里的 BLX
  BL 0x01ea92c8     若 33 返回：无条件 store r0
  movs r0, #0x55    再次覆盖 r0
```

Wrap `0x01ea7ce8`：

```text
ldr r0, [pc, #0xc]
push {r7, lr}
add r0, pc
ldr r0, [r0, #0x38]   ; EXT+0 = mr_table @ 0x10000
add r0, #0x80
ldr r0, [r0, #4]      ; [0x10084] = table[33]
blx r0                ; enc 0x4780
pop {r7, pc}          ; 回到 0x01ea7f7a
```

```text
mr_table + 33 * 4 = mr_table + 0x84 = 0x00010084
```

**CONFIRMED**（LIVE 编码 + 槽号）。

---

## 5. 本 init 返回值怎么用

Store helper `0x01ea92c8`（静态 **CONFIRMED**；因 STOP 未 LIVE 执行 STR）：

```text
0x01ea92c8  4901  ldr r1, [pc, #4]   ; literal 0x4358
0x01ea92ca  4449  add r1, r9         ; ER_RW + 0x4358
0x01ea92cc  6008  str r0, [r1, #0]
0x01ea92ce  4770  bx lr
0x01ea92d0  4358  .word 0x00004358
```

随后 caller `movs r0, #0x55`，时间值只活在 `ER_RW+0x4358`。

```text
这个真实 app 是否依赖 getTime 的绝对值？
  本 init：把绝对值写入 ER_RW+0x4358（CONFIRMED 静态 CFG）
还是只依赖差值？
  本 init：不是差值。pack 内其它 3 个 GOT wrap 有差值/deadline（见 §6）
还是当前 init 阶段根本丢弃返回值？
  否。不是丢弃；无条件 STR。LIVE 未执行到 STR（停在 stub）→ store LIVE = UNKNOWN
```

---

## 6. 全 pack table[33] callsite

唯一可靠 GOT 序列（`cfunction.ext`）：

```text
6b80 3080 6840 4780
ldr r0,[r0,#0x38]; add r0,#0x80; ldr r0,[r0,#4]; blx r0
```

正好 **4** 处（`add rN,#0x80` 另有 MUL/STRB 假阳性，不当 getTime）：

| GOT VA | wrap | 返回值用法（指令） | 本 init 是否执行 |
|---|---|---|---|
| `0x01ea7cee` | `0x01ea7ce8` | 交给 `0x01ea92c8` → STR `ER_RW+0x4358`（绝对值） | LIVE 停在 BLX |
| `0x01ea94e8` | `0x01ea94d8` | `t_old=*(ER_RW+0x84)`；getTime；`r0 = t_old - now`；`t_old==0` 则返回 0 | 否 |
| `0x01ea967c` | `0x01ea9674` | `r4 = arg`；getTime；`r0 = now + r4`；STR 到 `[r9 + literal]` | 否 |
| `0x01ea96ae` | `0x01ea96a8` | getTime；`old=*(r9+off)`；STR 0 清字段；`r1 = now - old` | 否 |

BL xref：

```text
→ 0x01ea7ce8 : 0x01e8d18c, 0x01e8d404, 0x01e8d416, 0x01e8d430,
               0x01ea6a92, 0x01ea7f76 (本 init), 0x01ea806e
→ 0x01ea94d8 : 0x01ea95d2
→ 0x01ea9674 : 0x01ea9622, 0x01ea974c
→ 0x01ea96a8 : 0x01ea5f06, 0x01ea7a0c
→ 0x01ea92c8 : 0x01ea7f7a  (本 init 的 store)
```

与 rxgj `docs/反汇编研究.c` 的 `mrc_timerLeft` / `mrc_timerStartEx` **指令形态对齐**（`stopTime - getTime`、`getTime + param`）。这是形态对照，**不是**把这些 wrap 命名成 timer API 的 LIVE 证明。

存在 `t2 - t1` / `leftover = stop - now` 模式：**CONFIRMED 指令**。因此常量 0 时间会让后续 wrap 算错。不要猜 FPS / network timeout。

---

## 7. `ER_RW+0x4358` 存储与读取

```text
getTime
  ↓
0x01ea92c8 STR [r9 + 0x4358]
  ↓
0x01ea8c0c  ldr [r9+0x4358] → mul/add → str 回同一字段
```

`0x4358` LE32 字面量 4 处：`0x01ea8c24`, `0x01ea92d0`(store helper), `0x01eb07fe`, `0x01eb0852`。后两处像数据/字符串。

`0x01ea8c0c`（静态）：

```text
ldr r0, [pc, #0x14]   ; 0x4358
add r0, r9
ldr r1, [r0]
mul / add
str r1, [r0]
bx lr
```

**INFERRED** 为该字段的后续算术消费者。本 init 因 STOP **未** LIVE 执行。

---

## 8. rxgj Runtime 时间来源（实现边界）

```text
rxgj FULL 在桌面运行时到底返回什么？
  CLOCK_MONOTONIC 毫秒 − native_uptime_base，再减 dsmStartTime
  = 自 DSM init 起的 monotonic elapsed ms（uint32）
```

不是 `SDL_GetTicks`，不是 `Date.now`，不是 `time()`。

Android JNI 不同：`gettimeofday` 相对 start（wall-based relative ms）。flymrp 对照的是 **FULL 桌面**。

---

## 9. 未接 JS 墙钟

本阶段禁止、也未添加：

```text
Date.now()
performance.now()
scheduler.now()
runtime.now → table[33]
```

尚未决定 flymrp 需要 deterministic virtual time / wall-clock / monotonic / scheduler-driven。只取证。

---

## 10. 现有 flymrp 时钟（只读，未接线）

| | |
|---|---|
| 字段 | `MythroadRuntime.clock`，初值 0 |
| `advance(ms)` | `clock += ms`（`ms < 0` 抛错），然后 `timers.due(clock)` |
| `step()` | 只派发已排队事件，**不**走时 |
| 已接同一时钟 | `sys.getuptime` → `rt.clock`；`_com(1)` → `rt.clock`；`TimerStart` deadline = `clock + interval` |
| `GetDatetime` | `profile.datetime` 日历，与 getTime **无关** |

```text
现有 runtime 是否已经有唯一时间源？
  对 Lua/timer 路径：是，runtime.clock。
  对 mr_table[33]：未接线。
```

| | |
|---|---|
| unit | 毫秒（调用方传入 `advance(ms)`） |
| type | 相对、宿主驱动 |
| monotonic | `advance` 拒绝负值，单调非减 |
| determinism | 测试驱动；不读 JS wall clock |

与 rxgj FULL `mr_getTime`（ms since start, monotonic, host-driven）**同形**。注意 JS `clock | 0` 是 **signed 32**，C 是 **uint32**（若将来实现需 `>>> 0`）。

**不要**在本阶段把 table[33] 接到 `clock`。

---

## 11. Q1–Q11

| | 答案 | 分级 |
|---|---|---|
| **Q1** identity/signature | `uint32 mr_getTime(void)` / `asm_mr_getTime` | **CONFIRMED** |
| **Q2** FULL 时间来源 | `clock_gettime(CLOCK_MONOTONIC)` → ms − `native_uptime_base` − `dsmStartTime` | **CONFIRMED** |
| **Q3** 单位 | 毫秒 | **CONFIRMED** |
| **Q4** wall vs monotonic | FULL 桌面：monotonic elapsed since DSM init，非 wall | **CONFIRMED**（FULL 桌面）。Android JNI 为 wall-based relative（对照记录，非本 runtime） |
| **Q5** 32-bit wrap | `uint32`，约 49.7 天；无符号差值在 wrap 后仍有效 | **CONFIRMED** |
| **Q6** 本 LIVE 调用是否用返回值 | 静态 CFG：无条件 STR `ER_RW+0x4358`。LIVE 未执行 store | 路径 **CONFIRMED**；store LIVE **UNKNOWN** |
| **Q7** 当前调用后 consumer | `0x01ea92c8` STR `[r9+0x4358]`；随后 `movs r0,#0x55`。更后 `0x01ea8c0c` 读写同一字段 | store helper **CONFIRMED**；`0x01ea8c0c` **INFERRED**（未 LIVE） |
| **Q8** cfunction.ext callsite | GOT 序列 **4**；init wrap 另有 **7** 个 BL | **CONFIRMED** |
| **Q9** 绝对值还是时间差 | 本 init 存绝对值；pack 内另有 `t_old-now`、`now+arg`、`now-old` | **CONFIRMED** 指令 |
| **Q10** runtime.clock 能否表达同样语义 | 能表达 ms / 相对 / 宿主驱动 / 单调；未接线；signed vs uint32 需注意 | 存在 **CONFIRMED**；可复用 **INFERRED** |
| **Q11** 现在是否有足够证据实现 table[33] | ABI 已清，但本阶段**禁止实现**。后续最小候选是 `runtime.clock>>>0`，不是 `Date.now`。常量 0 不安全 | 政策 **CONFIRMED 不实现** |

```text
Q11 现在实现？  NO
```

---

## 12. 生产状态（未改 ABI）

```text
table130    PASS / REAL_EXECUTED
table38     PASS / REAL_EXECUTED
table33     BLOCKED / LIVE REACHED

production mr_table:
25, 0, 125, 25, 0, 14, 130, 14, 38, 33

first production blocker = table[33]
```

---

## 13. 测试 / 工具

```bash
npx tsx tools/real/forensics-33.ts test/fixtures/real/app.mrp
```

- `src/real/gettime33.ts` — 只读取证
- `test/real/gettime-33-forensics.test.ts`
- `mr-table.ts` **无** `registerHandler(33)`
