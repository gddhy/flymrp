# Stage 5-C.6：table[130] / asm_mr_TestCom ABI Forensics

状态：**COMPLETE**（只取证）。**未实现 table[130]。Stage 5-D NOT STARTED。**

未实现：TestCom handler、其它未知 slot、host code 6 helper、`_plat*`、Canvas/Audio/网络。

---

## 1. 源码证据

`asm_mr_TestCom` **就是** `_mr_TestCom`：

```c
/* fixR9.h */
#define asm_mr_TestCom _mr_TestCom

/* mythroad.c */
_mr_c_function_table[130] = (void*)asm_mr_TestCom;

/* 声明 */
int _mr_TestCom(mrp_State* L, int input0, int input1);
```

`mr_helper.h`：`typedef int32 (*T__mr_TestCom)(int32 L, int input0, int input1);`

rxgj EXT 宿主 `aex_table.c` `aex_t130`：

```c
ret = _mr_TestCom(NULL, (int)r1, (int)r2);
```

忽略 guest `r0` / `r3`，强制 `L=NULL`。本次真实 guest `r0` 本来就是 0。

本体：`mythroad.c` `_mr_TestCom` ~3074–3288，`switch (input0)`。

**本次调用 `input0=7`：**

```c
#ifdef MR_PLAT_DRAWTEXT
        case 7:
            return input1;
#endif
```

- 有 `MR_PLAT_DRAWTEXT`：直接 `return input1`（本次即 9999 / `0x270f`），不走函数末尾。
- 无该宏：case 7 不存在；`L==NULL` 时末尾 `return 0`。

rxgj FULL / Android 构建 **定义了** `-DMR_PLAT_DRAWTEXT`（`CMakeLists.txt` `skyengine`、`Android.mk`）。这是 **rxgj 宿主编译开关**，不是 flymrp 已实现的行为。

case 7 本身：不访问全局、不调其它 C、不调其它 `_mr_c_function_table` slot、无平台 I/O。

整表 `_mr_TestCom` **不是**纯函数（时间、native 指针、socket、sms、`mr_plat` 等）。本次现场只打到 case 7。

Lua `TestCom` / `_com` 已在 `native.ts` 实现，**不是** table[130]。inventory 的 case 7 **没有**列为已实现 A code。

---

## 2. 真实 guest 调用点

```text
arm_ext_call(0)                    // mrc_init
  helper PC = 0x01ea5e9c / 0x01ea5e9d
    0x01ea5ece  BL  →  0x01e9ceec  // LR 回 helper = 0x01ea5ed3
      0x01e9ceec  PUSH {r4,r5,r7,lr}
      …
      0x01e9cf5a  movs r1, #7
      0x01e9cf5c  adds r2, r5, #0
      0x01e9cf5e  movs r0, #0
      0x01e9cf60  blx  r3          // r3 = table[130] stub
        table[130]  PC=0x00010208
```

`arm_ext_call(0)` 期间 **唯一** table 调用是 slot 130。`code0Slots = [130]`。

这不是 rxgj 样例 `mrc/asm/cfunction.ext.s`（ARM、`dest=0x80000`）。本 pack 调用点是 **Thumb**。

---

## 3. 进入 table[130] 前的寄存器

| 寄存器 | 值 | 来源 |
|---|---|---|
| R0 | `0` | `0x01e9cf5e` `movs r0, #0`（`2000`） |
| R1 | `7` | `0x01e9cf5a` `movs r1, #7`（`2107`） |
| R2 | `0x270f` | `0x01e9cf5c` `adds r2, r5, #0`（`1c2a`） |
| R3 | `0x00010208` | `ldr r3, [r0, #8]`，table 槽地址；给 `blx r3`，**不是** TestCom 参数 |
| R4 | `0x00200220` | ER_RW+4 |
| R5 | `0x270f` | `0x01e9cf0a` `ldr r5, [pc, #0x6c]` → 字面量 `0x01e9cf78 = 0x0000270f` |
| R6 | `0x00200100` | P |
| R7 | `0x0020021c` | ER_RW |
| R8 | `0` | — |
| R9 | `0x0020021c` | ER_RW（`arm_ext_call` 写入） |
| R10–R12 | `0` | — |
| SP | `0x01e7ffb0` | — |
| LR | `0x01e9cf63` | Thumb 返回到 `cmp r0, r5` |
| PC | `0x00010208` | EXT_TABLE + 130*4 |
| CPSR | `0x40000010` | USR、**T=0**（BLX 进 ARM stub）、Z=1 |

rxgj host 映射：`_mr_TestCom(NULL, r1=7, r2=0x270f)`。

---

## 4. R1 / R2 生产指令

**不要把 7 / 9999 说成 timeout / port / 长度 / socket。**

```text
0x01e9cf0a  4d1b  ldr  r5, [pc, #0x6c]   ; → 0x01e9cf78
0x01e9cf78            .word 0x0000270f   ; 立即数字面量，不是运行时计算

0x01e9cf5a  2107  movs r1, #7            ; R1 立即数
0x01e9cf5c  1c2a  adds r2, r5, #0        ; R2 ← R5 = 0x270f
0x01e9cf5e  2000  movs r0, #0
0x01e9cf60  4798  blx  r3
```

slot 指针：

```text
movs r1, #1
lsls r1, r1, #9          ; 0x200
adds r0, r0, r1          ; r0 原为 0x10000（mr_table）
ldr  r3, [r0, #8]        ; [0x10208] = table[130]
```

---

## 5. 是否调用其它 table slot

**本次调用：`no nested mr_table call`。**

- `aex_t130` 只进 `_mr_TestCom`。
- case 7 源码无其它 C / 无其它 slot。
- 动态：`arm_ext_call(0)` 直到 fault 只有 `[130]`。

整表其它 case 会调 `mr_getTime` / `mr_plat` / socket 等 **host C**，不是 guest `mr_table` 再入。与本次无关。

---

## 6. 返回值证据

| 条件 | 返回 | 证据 |
|---|---|---|
| `MR_PLAT_DRAWTEXT` + case 7 | `input1`（本次 9999） | `mythroad.c` `return input1`；rxgj FULL 定义该宏 |
| 无 case 7 且 `L==NULL` | `0` | 函数末尾 `else return 0` |
| `L != NULL` | Lua 压栈，返回 1 | 本次 host 传 `NULL`，不走 |

**flymrp 未实现 handler，没有运行时返回值。** 不要把 rxgj 编译开关当成已接线 ABI。

guest **返回后**（handler 未跑，未执行）：

```text
0x01e9cf62  42a8  cmp  r0, r5        ; r5 = 0x270f
0x01e9cf64  d101  bne  0x01e9cf6a    ; 不等 → 跳过写
0x01e9cf66  3802  subs r0, #2        ; 0x270f - 2 = 0x270d
0x01e9cf68  61a0  str  r0, [r4, #0x18]
0x01e9cf6a  bdb0  pop  {r4, r5, r7, pc}
```

`[r4, #0x18] = ER_RW+0x1c`。本 pack **不是** `反汇编研究.c` 的 `r9+0x2c` / 样例 `r4+0x28`。

`docs/反汇编研究.c` 模式（**INFERRED 对照，不是本 pack 反编译**）：

```c
if (mr_table._mr_TestCom(0, 7, 9999) == 9999)
    *(r9 + 0x2c) = 0x270d;
```

本 pack：相等则写 `0x270d` 到 **ER_RW+0x1c**；不等则不写，直接 pop。

---

## 7. 是否修改 ER_RW

| 谁 | 写 ER_RW？ |
|---|---|
| `_mr_TestCom` case 7 | **否**（`return input1`） |
| 当前 handler | **未实现，未写**。故障瞬间 `ER_RW+0x1c = 0` |
| guest 返回后 | **若 r0==0x270f** 则写 `0x270d` 到 ER_RW+0x1c（CFG CONFIRMED；未执行） |

---

## 8. 是否启动必需 ABI

| 命题 | 分级 |
|---|---|
| `arm_ext_call(0)` / mrc_init **会调用** table[130] | **CONFIRMED** |
| 无 handler → 启动 **STOP** | **CONFIRMED** |
| 必须返回 9999 才能继续后续 init | **UNKNOWN** |
| 返回 0 则跳过 store、本函数 pop 后 helper 下一 BL（`0x01ea5ed2`）仍会执行 | **INFERRED**（CFG，未跑） |
| `0x270d` 对后续逻辑的含义 | **UNKNOWN** |

调用在启动路径上。缺 handler 是当前 first fault。**本阶段不实现。**

---

## 9. CONFIRMED / INFERRED / UNKNOWN

### CONFIRMED

- table[130] = `asm_mr_TestCom` = `_mr_TestCom`
- 原型 `(L, input0, input1)`；rxgj host：`(NULL, r1, r2)`
- 本次：`r0=0` `r1=7` `r2=0x270f` `r9=ER_RW` `PC=0x10208` `LR=0x01e9cf63`
- R1 / R2 生产指令如上（立即数 / PC 字面量），不是运行时算出来的
- 调用点：helper `0x01ea5ece` `BL 0x01e9ceec` → `blx r3`
- 本次 **无嵌套** mr_table
- case 7 本身不改 ER_RW、无平台 I/O
- code 6 已由 guest helper 跑完；不要实现 host code 6 helper
- 未实现 table[130]；first fault 仍是 `UNKNOWN_REQUIRED_SLOT = 130`

### INFERRED

- 返回 `0x270f` 时 guest 写 `0x270d` 到 ER_RW+0x1c（指令在，handler 未返回，写未发生）
- 与 `反汇编研究.c` / 样例 `.s` 同属「比较 9999 再写 0x270d」模式；**偏移不同**
- 返回 0 时本函数仍可 pop 继续
- rxgj FULL 上本次调用会 `return 9999`

### UNKNOWN

- `7` / `9999` 的业务语义（**禁止猜测**）
- `0x270d` 以及 ER_RW+0x1c 后续谁读
- flymrp 若实现，应返回 0 还是 9999
- 返回值是否影响后续 init / 其它 slot
- 不要把 7/9999 说成 timeout/port/socket/长度

---

## 10–12. 验收

```text
[x] 源码证据（声明 / 宏 / table / aex_t130 / case 7）
[x] 本 pack 调用点 + helper BL
[x] R0–R3 / R9 / SP / LR / CPSR
[x] R1/R2 生产指令（立即数 + 字面量）
[x] no nested mr_table call
[x] 返回值：源码 + guest 比较/条件写；无运行时返回
[x] TestCom 本身不改 ER_RW
[x] 启动路径会调用；返回值是否必需 = UNKNOWN
[x] 不实现 table[130]
[x] 无假平台 / 无 host-independent 返回值 fixture
    （整表非纯函数；case 7 依赖编译宏；写返回值 fixture = 实现 TestCom）
[ ] Stage 5-D  NOT STARTED
```

```bash
npm test
npx tsc --noEmit
npx tsx tools/real/forensics-130.ts test/fixtures/real/app.mrp
```

只读取证：`src/real/testcom130.ts`，`test/real/testcom-130.test.ts`。
