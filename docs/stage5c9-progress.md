# Stage 5-C.9：`table[38] / asm_mr_platEx` ABI Forensics

状态：**COMPLETE**（只取证）。**未实现 table[130]、table[38]、table[33]。Stage 5-D NOT STARTED。**

生产路径仍停在 `UNKNOWN_REQUIRED_SLOT = 130`。  
probe 仅用 `cbRet(r0=0)` 越过 130（**不** `registerHandler`），在 table[38] 入口快照后仍抛 38。**不越过 38。**

源码里 **没有** `_mr_platEx` 这个符号。真实名字是 `mr_platEx`，经 `#define asm_mr_platEx mr_platEx` 挂到 `_mr_c_function_table[38]`。

---

## 1. C ABI（rxgj）

```text
typedef void (*MR_PLAT_EX_CB)(uint8 *output, int32 output_len);

int32 mr_platEx(int32 code,
                uint8 *input,
                int32 input_len,
                uint8 **output,
                int32 *output_len,
                MR_PLAT_EX_CB *cb);
```

| | |
|---|---|
| 返回 | `int32`（`MR_SUCCESS` / `MR_FAILED` / `MR_IGNORE` 等） |
| 嵌套 mr_table | **本次 code 路径无**（见下） |
| `MR_PLAT_DRAWTEXT` | **不**包住 1222/1223 分支 |
| FULL / MINI | 两份 mythroad 都把 `[38]` 指到 `asm_mr_platEx`。`mr_platEx` 本体在 `dsm.c`。`DSM_FULL` 只影响 `dsm_init` 的 Lua 库，**不**改 1222 分支 |

`dsm.c` 是大 `switch (code)`，另有 media 前缀分流。**不要**把整个 dispatcher 当成这次 guest call 的行为。

本次 LIVE `code=0x4c6` 在 FULL `dsm.c` 中：

```c
case MR_TUROFFBACKLIGHT:
case MR_TURONBACKLIGHT:
    return MR_SUCCESS;
```

无全局写、无其它 C、无其它 slot。Android 同源分支同样 `return MR_SUCCESS`（`keepScreenOn` 已注释）。  
`#define MR_TURONBACKLIGHT 1222` 只记录 **数值对应**。不把这次 guest call 命名成背光业务。

flymrp：`table[38]` **未实现**。

---

## 2. 本次 LIVE 调用 ABI

```text
slot 38
identity: CONFIRMED
C signature: int32 mr_platEx(int32, uint8*, int32, uint8**, int32*, MR_PLAT_EX_CB*)
caller:  0x01ea666a  BLX r4
stub:    0x00010098
R0: 0x4c6          code
R1: 0              input
R2: 0              input_len
R3: 0              output
stack args:
  [SP+0] = 0       output_len
  [SP+4] = 0       cb
not args:
  [SP+8] = 0       saved r4
  [SP+12]= 0x01ea7f77  saved Thumb LR of BL 0x01ea7f72
SP: 0x01e7ff98     8-byte aligned
return consumer: none
```

Guest **明确构造了 6 个参数**：`sub sp,#8`；`movs r3,#0`；`str r2,[sp]` / `[sp,#4]`；`movs r1,#0`；`ldr r0, [pc,#…] = 0x4c6`；`blx r4`。  
`[SP+8]` / `[SP+12]` 是 wrapper 的 `push {r4,lr}`，**不是**第 7/8 参数。

AAPCS 对应：

```text
r0 = code
r1 = input
r2 = input_len
r3 = output
[sp+0] = output_len
[sp+4] = cb
```

---

## 3. `0x4c6` 来源

**PC-relative literal**，不是 ER_RW、不是参数、不是其它函数返回值。

```text
0x01ea7f70  movs r0, #0          ; 进入 wrapper 的选择子
0x01ea7f72  BL   0x01ea664c
…
0x01ea665c  cmp  r0, #0
0x01ea665e  bne  0x01ea6670      ; r0!=0 → Path B
; Path A (本次 LIVE)
0x01ea6668  ldr  r0, [pc, #0x18] ; @ 0x01ea6684 = 0x4c6
0x01ea666a  blx  r4
```

`cfunction.ext` 里 **只有一处** `0x4c6` 字面量：`0x01ea6684`。

同一 wrapper 的 Path B（本次 **不走**）：

```text
0x01ea6678  ldr r0, [pc, #0x0c]  ; @ 0x01ea6688 = 0x4c7
0x01ea667a  blx r4
0x01ea667c  b   0x01ea666c
```

`0x4c7 == 1223` 与 `MR_TUROFFBACKLIGHT` 宏数值相同。只记录数字。本次 init 因 `movs r0,#0` **只打 0x4c6**。

---

## 4. 全 pack table[38] 调用点

| BLX | command 字面量 | 是否本 init CFG | 分级 |
|---|---|---|---|
| `0x01ea666a` | `0x4c6` | **是（LIVE）** | **CONFIRMED** |
| `0x01ea667a` | `0x4c7` | 否（同函数 Path B） | **CONFIRMED** 存在；**CONFIRMED** 本次不执行 |
| `0x01ea6934` | `0x4b4` | 否 | **CONFIRMED** 静态 PIC（GOT+0x98） |
| `0x01ea617a` | `0x4b4` | 否 | **INFERRED**（`[r6,#0x38]` 基址未 LIVE） |

`0x4b4 == 1204`（`MR_SWITCHPATH` 宏）。不在本次 code-0 直达路上。不实现。

假阳性：`0x01ea1b48` / `0x01ea1ba6` 的 `add #0x80; ldr #0x18` 是对象字段运算，**不是** mr_table。

---

## 5. 返回后 CFG → slot 33

```text
0x01ea666a  blx r4            ; table[38]
0x01ea666c  add sp, #8
0x01ea666e  pop {r4, pc}      ; 不读 r0
            → 0x01ea7f76
0x01ea7f76  BL  0x01ea7ce8    ; 中间无 cmp / 条件跳
```

`0x01ea7ce8`：

```text
ldr r0, [pc, #…]     ; GOT → 覆盖 platEx 返回值
add r0, pc
ldr r0, [r0, #0x38]  ; EXT+0 = mr_table
add r0, #0x80
ldr r0, [r0, #4]     ; [0x10084] = table[33]
blx r0
pop {r7, pc}
```

**CONFIRMED**：本次 wrapper 返回后 **无条件** 进入 `0x01ea7ce8`，该函数 **BLX table[33]**。  
platEx 的 r0 **不影响** 是否调用 33，也 **不是** 33 的参数（r0 在 BLX 前被改成 stub）。

### slot 33（只静态，不实现）

```text
identity: CONFIRMED  mythroad.c [33] = asm_mr_getTime
          fixR9.h: #define asm_mr_getTime mr_getTime
C: uint32 mr_getTime(void)
本次：未执行（38 先抛）
NEXT_UNKNOWN_SLOT = 33   （若 38 返回）
```

`0x01ea7f7a BL 0x01ea92c8` 会 `str r0, [r9+#0x4358]`，即 **getTime 的返回值会被存进 ER_RW**。这是 33 的消费者，不是 38 的。不实现 33。

---

## 6. `0x01ea9254`

helper 在 `0x01ea7f68` **整函数返回之后** 才 `BL 0x01ea9254`。  
`0x01ea7f68` 收尾是 `movs r0,#0`，与 38 返回值无关。

LIVE：`init2Reached = false`（被 38 挡住）。  
本阶段 **不再** 用 bypass 往前推。静态结构见 `docs/stage5c8-progress.md`。

---

## 7. Q1–Q9

| | 答案 | 分级 |
|---|---|---|
| **Q1** `_mr_platEx` 的真实 C ABI？ | **没有 `_mr_platEx`。** 真实为 `int32 mr_platEx(int32, uint8*, int32, uint8**, int32*, MR_PLAT_EX_CB*)` | **CONFIRMED** |
| **Q2** 当前调用是否 6 参数？ | **是。** r0–r3 + `[sp]` + `[sp+4]`。`[sp+8/12]` 不是参数 | **CONFIRMED** |
| **Q3** `0x4c6` 来源？ | Path A 的 PC literal `0x01ea6684`。调用方 `movs r0,#0` 选中这条 | **CONFIRMED** |
| **Q4** rxgj FULL 对该参数的行为？ | `dsm.c`：`return MR_SUCCESS`；无副作用。这是 **宿主策略**，不是 guest 证明 flymrp 必须同样做 | FULL 文本 **CONFIRMED**；“flymrp 必须 SUCCESS” **不是 CONFIRMED** |
| **Q5** flymrp 是否有足够证据实现本次 table[38]？ | **没有。** ABI 已清，但返回值被丢弃；FULL 的 SUCCESS 不能当成必须实现的依据；本阶段禁止为继续跑而加 handler | **CONFIRMED**（不实现） |
| **Q6** 返回值是否影响 `mrc_init`？ | **不影响** 是否继续：无 cmp，下一 BL 覆盖 r0 | **CONFIRMED** |
| **Q7** table[33] 是否 38 后的下一个真实阻塞点？ | 生产仍是 **130**。越过 130 后 LIVE 阻塞是 **38**。若 38 返回，下一未知 slot **是 33**（无条件） | 130/38 LIVE **CONFIRMED**；33 为下一未知 **CONFIRMED**（静态 CFG）；33 LIVE **UNKNOWN**（未执行） |
| **Q8** `0x01ea9254` 是否可继续取证？ | **静态可以**（C-8 已做）。**LIVE 不可以**，除非再 bypass 38/33。本阶段停止 | 静态 **CONFIRMED**；LIVE **CONFIRMED 未到达** |
| **Q9** 当前生产路径最小阻塞点？ | **table[130]**。本 init CFG 上 130 之后的新未知 ABI：**table[38]** | **CONFIRMED** |

---

## CONFIRMED / INFERRED / UNKNOWN

### CONFIRMED

- 无 `_mr_platEx`；`[38] = asm_mr_platEx = mr_platEx`
- 本次 6 参数 `(0x4c6, 0, 0, 0, 0, 0)`，SP 8 对齐
- `0x4c6` 是 literal；pack 内仅一处
- 返回值不参与后续条件
- 返回后无条件 `BL 0x01ea7ce8` → table[33]
- 未注册 130/38/33；生产 first fault 仍是 130
- `[33] = asm_mr_getTime`（源码）

### INFERRED

- `0x01ea617a` 也是 platEx（`0x4b4`），基址来自 `r6`
- Path B `0x4c7` 与 `MR_TUROFFBACKLIGHT` 宏成对出现在同一 wrapper

### UNKNOWN

- 38/33 若返回后，`0x01ea7f68` 后半段与 `0x01ea9254` 的 LIVE ABI
- flymrp 若实现 38，应返回 SUCCESS 还是 IGNORE（guest 不读 r0）

---

## 明确没有做

- 未实现 table[38] / `_platEx` / `MR_TURONBACKLIGHT` / 背光
- 未实现 table[33] / table[130]
- 未加返回 0/9999 fallback
- 未改 Canvas / network / `_plat`
- 未进入 Stage 5-D

复现：

```bash
npx tsx tools/real/forensics-c9.ts test/fixtures/real/app.mrp
```
