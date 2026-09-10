# Stage 5-C.8：`mrc_init` 后继未知 BLX / mr_table ABI

状态：**COMPLETE**（只取证）。**未实现 table[130]、table[38]。Stage 5-D NOT STARTED。**

生产路径仍停在 `UNKNOWN_REQUIRED_SLOT = 130`。  
本阶段用 **probe-only** 的 `cbRet(r0=0)` 越过 130（**不** `registerHandler(130)`），观察 `0x01ea7f68` 之后的真实 BLX。5-C.7 已证明返回 0 与返回 `0x270f` 在这段 helper 直达 CFG 上合流。

---

## 真实 code-0 调用链

```text
_strCom(801, ..., 0)
  ↓
arm_ext_call(0)
  ↓
mrc_init helper 0x01ea5e9c
  ↓
table[130]  _mr_TestCom(NULL, 7, 0x270f)     未实现；probe 以 r0=0 返回
  ↓
helper 0x01ea5ed2
  ↓
BL  0x01ea7f68
  ├─ BL  0x01eab1ac
  │    BLX r3  ← r3 = *[r9, #0x50] = 0x10038
  │    table[14]  memset2(ER_RW+0x1940, 0, 0x78)     已实现
  ├─ movs r0, #0
  ├─ BL  0x01ea664c
  │    BLX r4  ← r4 = *[ *(EXT+0) + 0x98 ] = 0x10098
  │    table[38]  asm_mr_platEx(0x4c6, 0, 0, 0, 0, 0)  STOP（未实现）
  ├─ BL  0x01ea7ce8     未执行
  ├─ BL  0x01ea92c8     未执行
  └─ … 未执行
  ↓
BL  0x01ea9254          未执行（PC 从未到达）
  ↓
B   0x01ea5f3c          未执行
```

每个已执行的 `???` 都有地址和 ABI 证据。未执行的后继只标 STATIC / INFERRED。

---

## 1. `0x01ea7f68`（完整到 `pop {r4,r5,r6,pc}`）

```text
0x01ea7f68  push {r4,r5,r6,lr}
0x01ea7f6a  sub  sp, #8
0x01ea7f6c  BL   0x01eab1ac          ; → table[14]  LIVE
0x01ea7f70  movs r0, #0
0x01ea7f72  BL   0x01ea664c          ; → table[38]  LIVE STOP
0x01ea7f76  BL   0x01ea7ce8          ; 未执行；静态 [mr_table+0x84] = slot 33
0x01ea7f7a  BL   0x01ea92c8          ; 未执行；只 STR [r9+0x4358]，无 BLX
0x01ea7f7e  movs r0, #0x55
0x01ea7f80  BL   0x01e9a8d8          ; 未执行
0x01ea7f8c  BL   0x01eaad6c          ; 未执行
0x01ea7fa0  BL   0x01e92d2c          ; 未执行；内部再 BLX [r9,#0x50] / [r9,#0x60]
0x01ea7fa6  cmp  r0, #0
0x01ea7fa8  beq  0x01ea7fe0
0x01ea7fb0  BL   0x01ea6dd4          ; 未执行
0x01ea7fb4  BL   0x01eab1ac
0x01ea7fd6  BL   0x01ea8a20
0x01ea7fda  movs r0, #0
0x01ea7fdc  add  sp, #8
0x01ea7fde  pop  {r4,r5,r6,pc}
```

`0x01ea7f72` 之后 **没有** `cmp r0`。若 38 返回，CFG 会无条件进入 `0x01ea7ce8`（INFERRED，未跑到）。

---

## 2. 已执行的 mr_table 调用

### slot 14 — `memset2`（已知，不重复实现）

```text
identity: CONFIRMED  mythroad.c _mr_c_function_table[14] = memset2
caller:   0x01eab1cc  BLX r3
stub:     0x00010038
R0: 0x00201b5c   (= ER_RW + 0x1940)
R1: 0
R2: 0x78
R3: 0x00010038
R9: 0x0020021c
LR: 0x01eab1cf
return consumer: 0x01ea7f70 立刻 movs r0, #0（覆盖返回值）
side effects: 把 ER_RW+0x1940 起 0x78 字节置 0；并在 dest-0x10 写了 4 个字头
```

指针来源（CONFIRMED）：

```text
0x01eab1be  ldr r3, [pc, #0x14]   ; literal 0x50 @ 0x01eab1d4
0x01eab1c2  add r3, r9
0x01eab1c4  ldr r3, [r3]          ; [ER_RW+0x50] = 0x10038
0x01eab1cc  blx r3
```

`[r9,#0x50]` 在进入 38 时仍是 table[14] stub。同区 `+0x54…+0x64` 是 slot 15–19 的拷贝（LIVE 读数）。这是 guest 内部对已拷贝 stub 的间接调用，**不是**新的未知 host ABI。

### slot 38 — `asm_mr_platEx`（新未知 host ABI，未实现）

```text
identity: CONFIRMED  mythroad.c _mr_c_function_table[38] = asm_mr_platEx
          fixR9.h: #define asm_mr_platEx mr_platEx
          aex_table.c aex_t038: mr_platEx(r0, input, r2, output, output_len, cb)
caller:   0x01ea666a  BLX r4
stub:     0x00010098
R0: 0x4c6
R1: 0
R2: 0
R3: 0
[sp+0]: 0
[sp+4]: 0
R9: 0x0020021c
LR: 0x01ea666d
SP: 0x01e7ff98
return consumer: 未执行（dispatch 抛 UNKNOWN）
side effects: 无（handler 不存在）
```

C 签名：

```text
int32 mr_platEx(int32 code, uint8 *input, int32 input_len,
                uint8 **output, int32 *output_len, MR_PLAT_EX_CB *cb);
```

本次 AAPCS：`(0x4c6, NULL, 0, NULL, NULL, NULL)`。

指针来源（CONFIRMED）：

```text
0x01ea664e  ldr r1, [pc, #0x30]   ; 0xfffd9972
0x01ea6652  add r1, pc            ; r1 = 0x01e7ffc8
0x01ea6654  ldr r1, [r1, #0x38]   ; [0x01e80000] = EXT+0 = 0x10000
0x01ea6658  add r1, #0x80
0x01ea665a  ldr r4, [r1, #0x18]   ; [0x10098] = table[38] stub
0x01ea665c  cmp r0, #0            ; 调用方 movs r0, #0 → 走 call
0x01ea6660  movs r2, #0
0x01ea6662  str r2, [sp]
0x01ea6664  str r2, [sp, #4]
0x01ea6666  movs r1, #0
0x01ea6668  ldr r0, [pc, #0x18]   ; literal 0x4c6 @ 0x01ea6684
0x01ea666a  blx r4
```

`0x4c6 == 1222`。`mrporting.h` 有 `#define MR_TURONBACKLIGHT 1222`。这是 **数字与宏的对应**，不是要实现背光的依据。`dsm.c` 对该 case 写 `return MR_SUCCESS`。**本阶段不实现 platEx。**

---

## 3. 未执行、仅静态的后继

### `0x01ea7ce8`（38 返回后的下一 BL，INFERRED）

同一 GOT：`[EXT+0] + 0x80 + 4` → `[0x10084]` → **slot 33**（源码 `asm_mr_getTime`）。未执行。

### `0x01ea9254`（helper 第二段，CONFIRMED 未到达）

```text
0x01ea9254  push {r1-r5,lr}
0x01ea9256  ldr  r4, [pc, #0x4c] ; 4
0x01ea9258  add  r4, r9          ; r4 = ER_RW+4
0x01ea925a  ldr  r0, [r4, #0x64]
0x01ea925c  cmp  r0, #0
0x01ea925e  bne  0x01ea9272
            BL   0x01ea7c68      ; 静态：[mr_table+0x140] = slot 80
…
0x01ea9272  ldr  r0, [r4, #0x68]
0x01ea9274  cmp  r0, #1
0x01ea9276  bne  0x01ea929c      ; !=1 则跳过 BLX
…
0x01ea929a  blx  r5              ; 静态：r5 = [mr_table+0x74] = slot 29
0x01ea929c  movs r0, #0
0x01ea929e  str  r0, [r4, #0x68]
0x01ea92a0  pop  {r1-r5,pc}
```

LIVE：`init2Reached = false`。  
INFERRED：若进入且 `[ER_RW+0x6c]==1`，BLX 目标是 table stub；`[ER_RW+0x68]==0` 时会先走 `0x01ea7c68`。  
不要把未执行的 slot 29/80 命名成业务功能并实现。

---

## 4. Q1–Q7

| | 答案 | 分级 |
|---|---|---|
| **Q1** `0x01ea7f68` 是否调用新的 mr_table slot？ | **是。** 先 14（已知），再 **38（新）** | **CONFIRMED** |
| **Q2** 哪些 slot？ | LIVE：14、38。静态下一 BL：33（未执行） | 14/38 **CONFIRMED**；33 **INFERRED** |
| **Q3** 每个 slot 的 R0–R3？ | 14：`(ER_RW+0x1940, 0, 0x78, stub)`；38：`(0x4c6, 0, 0, 0)` + `[sp]=0,[sp+4]=0` | **CONFIRMED** |
| **Q4** 是否有新的未知 host ABI 阻塞 `mrc_init`？ | **是：table[38] / `asm_mr_platEx`。** 生产路径仍先被 130 挡住 | **CONFIRMED** |
| **Q5** `0x01ea9254` 是否也调用 mr_table？ | **本次未执行。** 静态有 `BLX r5` / `BL 0x01ea7c68`，指针链指向 table stub | 未执行 **CONFIRMED**；目标 slot **INFERRED** |
| **Q6** code-0 当前能否继续向下推进？ | **不能。** 生产停 130；probe 越过 130 后停 38；到不了 `0x01ea9254` / helper epilogue | **CONFIRMED** |
| **Q7** 当前最小的下一个阻塞点？ | 生产：**table[130]**（未实现）。本 init CFG 上 130 之后的新未知 ABI：**table[38]** `platEx(0x4c6,0,0,0,0,0)` | **CONFIRMED** |

---

## CONFIRMED / INFERRED / UNKNOWN

### CONFIRMED

- `0x01ea7f68` 第一个 callee `0x01eab1ac` 经 `[r9,#0x50]` 打 table[14]
- 紧接着 `0x01ea664c` 经 `*(EXT+0)+0x98` 打 table[38]
- EXT+0 = `0x10000`（mr_table 基址）
- table[38] 源码身份 = `asm_mr_platEx` / `mr_platEx`
- 本次 platEx 六参数全在寄存器/栈上取到，均为 0，除 code=`0x4c6`
- 生产 first fault 仍是 130；probe first **new** unknown 是 38
- `0x01ea9254` 在本次 code-0 中未执行
- 未 `registerHandler(130)` / `registerHandler(38)`

### INFERRED

- 38 若返回，下一 BL `0x01ea7ce8` 会打 table[33]（`asm_mr_getTime`）
- `0x01ea9254` 在特定 ER_RW 标志下会打 table[29] 和/或 table[80]
- `0x4c6` 与 `MR_TURONBACKLIGHT` 宏数值相同；rxgj `dsm.c` 对该 case `return MR_SUCCESS`

### UNKNOWN

- platEx `0x4c6` 在本 pack 后续路径上的真实副作用（未执行 handler）
- `0x01ea7f68` 在 38 之后的整段 LIVE ABI
- `0x01ea9254` 的 LIVE 标志与 BLX 实参
- 是否还有 38 之后的未知 slot 才能回到 host

---

## 明确没有做

- 未实现 table[130] / table[38] / `_plat` / `_platEx`
- 未实现 network / Canvas / DrawText
- 未为测试加 fallback
- 未进入 Stage 5-D

复现：

```bash
npx tsx tools/real/forensics-c8.ts test/fixtures/real/app.mrp
```
