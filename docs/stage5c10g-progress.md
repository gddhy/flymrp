# Stage 5-C.10G：Minimal table[17] / sprintf_ `%d` + Real MRP Re-run

状态：**COMPLETE**（实现 guest-aware `sprintf_` 的 **literal + `%d`** 子集）。**未实现 `%s` / 其它 specifier / table[26] printf / table[40]。Stage 5-D NOT STARTED。**

```text
Only the observed guest sprintf subset consisting of
literal bytes and %d is currently implemented.
```

```text
table130  PASS / REAL_EXECUTED
table38   PASS / REAL_EXECUTED
table33   PASS / REAL_EXECUTED
table17   PASS / REAL_EXECUTED
table40   BLOCKED / LIVE REACHED

first production blocker after implementing table17 = table[40]
```

禁止项（本阶段均未做）：`%s`、其它 specifier、完整 mpaland、host libc sprintf / `util.format` / sprintf-js / host `va_list`、table[26]、table[40] handler、新 platEx / TestCom case、forensic bypass、Canvas / Audio / Network、Stage 5-D。

---

## Q&A

| | |
|---|---|
| **Q1** table17 是否实现？ | **是。** `mr_table[17]` → `sprintf_` → `guestSprintf` |
| **Q2** 是否只有 literal + `%d`？ | **是。** `%s` / `%x` / `%u` / `%c` / `%02d` / `%%` / `%i` → `UnknownAbiError` `unsupported sprintf format` |
| **Q3** 是否 guest-aware，完全不构造 host va_list？ | **是。** 从 GuestMemory 读 format，按 AAPCS 只在真正消费 `%d` 时读 vararg。无 host `va_list` / libc sprintf / `util.format` |
| **Q4** `%d` 是否按 int32？ | **是。** `word \| 0`。`0x80000000` → `"-2147483648"`；`0xffffffff` → `"-1"` |
| **Q5** 是否正确 NUL terminate？ | **是。** LIVE 第 13 字节为 `0` |
| **Q6** LIVE 是否得到 `"res_lang0.rc"`？ | **CONFIRMED**（GuestMemory `0x01e7ff74`，不再是 INFERRED） |
| **Q7** sprintf return 的源码语义是什么，实际返回多少？ | mpaland `_vsnprintf`：**written chars without terminating NUL**（`printf.c` `return (int)idx`）。LIVE **12**（`"res_lang0.rc".length`）。guest 随后 `MOVS r0,#0` 覆盖，handler 仍返回 12 |
| **Q8** guest 是否继续消费该 buffer？ | **是。** `0x01ea8cdc` LIVE：`r0=0` `r1=0x01e7ff74` `name="res_lang0.rc"` |
| **Q9** 是否 LIVE 到达 table125/readFile？ | **否。** `table125After17=false`；VFS 仍只有 `cfunction.ext` 等既有读取，没有 `res_lang0.rc` |
| **Q10** 是否越过原 table17 blocker？ | **是。** table[17] `REAL_EXECUTED` |
| **Q11** 新 first production blocker 是什么？ | **table[40]** `UNKNOWN_REQUIRED_SLOT = 40`。源码 identity：`asm_mr_open` / `int32 mr_open(const char *filename, uint32 mode)`。本阶段 **未实现** |
| **Q12** 是否遇到第二次 table17？ | **否。** LIVE `table17Count=1` |
| **Q13** 是否遇到 `%s`？ | **否。** 未触发 `unsupported sprintf format` |
| **Q14** 新 production mr_table sequence？ | `25, 0, 125, 25, 0, 14, 130, 14, 38, 33, 17, 40` |
| **Q15** 5 次启动是否 deterministic？ | **是** |
| **Q16** 是否添加 forensic bypass？ | **否** |

---

## 实现

```ts
// MrTableBridge.sprintf → guestSprintf(mem, R0, R1, aapcsSprintfVararg)
// vararg index 0 → R2；index 1 → R3；2+ → [SP+(n-2)*4]
// 只有真正消费的 `%d` 才调用 nextVararg
```

```c
int sprintf_(char *buffer, const char *format, ...);
```

返回值按 mpaland `printf.c`：

```c
// termination
out((char)0, buffer, idx < maxlen ? idx : maxlen - 1U, maxlen);
// return written chars without terminating \0
return (int)idx;
```

inventory：`mr_table/17/sprintf/%d`

不是：完整 printf、libc sprintf、host `va_list`。

---

## 真实启动链（LIVE，无 bypass）

```text
app.mrp → start.mr → 601/800/801(1)/800/801(6)/801(0)
  → table[130] REAL_EXECUTED
  → table[14] REAL_EXECUTED
  → table[38] REAL_EXECUTED
  → table[33] REAL_EXECUTED  mr_getTime → 0
  → table[17] REAL_EXECUTED  sprintf_("res_lang%d.rc", 0)
       buffer 0x01e7ff74 = "res_lang0.rc\0"
       return 12
  → 0x01e9a882  MOVS r0,#0 ; r1 = buffer
  → BL 0x01ea8cdc   LIVE CONFIRMED name="res_lang0.rc"
  → 0x01ea8cfc / 0x01ea8d04 / 0x01ea8dec / 0x01ea8e8e / 0x01ea89d8
  → table[40] STOP  NOT_EXECUTED by host   asm_mr_open
```

mr_table 生产调用序：

```text
25, 0, 125, 25, 0, 14, 130, 14, 38, 33, 17, 40
```

---

## LIVE table[17]（入口，insn=183）

```text
PC    0x00010044
LR    0x01e9a883
SP    0x01e7ff68
R0    0x01e7ff74   buffer
R1    0x01eaf204   "res_lang%d.rc"
R2    0            first vararg (%d)
R3    0x00010044   BLX stub，不是 vararg
R9    0x0020021c
CPSR  0x10
```

写入后 GuestMemory：

```text
72 65 73 5f 6c 61 6e 67 30 2e 72 63 00
r  e  s  _  l  a  n  g  0  .  r  c  \0
```

---

## LIVE consumer `0x01ea8cdc`

**CONFIRMED**（fetch 时寄存器，不是 INFERRED）：

```text
PC  0x01ea8cdc
R0  0
R1  0x01e7ff74  "res_lang0.rc"
R2  0x01e7ff70
R3  0x01e7ff6c
LR  0x01e9a893
```

随后 guest 继续，**下一次** mr_table 是 slot 40，不是 table[125] `_mr_readFile`。

---

## 新 blocker：table[40] `asm_mr_open`（未实现）

源码：`mythroad.c` `_mr_c_function_table[40] = (void*)asm_mr_open;`  
`fixR9.h`：`#define asm_mr_open mr_open`  
`int32 mr_open(const char *filename, uint32 mode);`  
`MR_FILE_RDONLY = 1`

LIVE 入口（insn=221）：

```text
slot   40
stub   0x000100a0
R0     0x00200058   heap 指针；前 32 字节全 0（空 C 串）LIVE
R1     1            MR_FILE_RDONLY
R2     0x000100a0   BLX stub 残留，不是 filename
R3     0x01e7ff6c   stack
R4     0x01e7ffc8
R5     0x00200058
R6     0x01e7ff74   仍是 sprintf buffer "res_lang0.rc"
R7/R9  0x0020021c   ER_RW
SP     0x01e7ff00
LR     0x01ea89e7
CPSR   0x10
stack  0x0020021c  0x01ea8e97  0  0
```

R0 **不是** `"res_lang0.rc"`。sprintf 文件名仍在 R6。本阶段不实现 slot 40，也不猜测为何 R0 为空串。

---

## 确定性（5 次）

比较：first blocker / PC / P / helper / ER_RW / mr_table sequence / ARM insn / Lua insn / formatted filename。

```text
deterministic: yes
firstUnknownSlot: 40
stopPc: 0x000100a0
P: 0x00200100
helper: 0x01ea5e9d
ER_RW: 0x0020021c
armInsnCount: 221
luaInsnCount: 71
tableSlots: 25, 0, 125, 25, 0, 14, 130, 14, 38, 33, 17, 40
sprintfFilename: res_lang0.rc
```

---

## 测试

- `test/real/sprintf-17-abi.test.ts`：literal / `%d` / int32 边沿 / R3 poison / unsupported / MemoryFault / NUL / 返回长度
- `test/real/real-mrp-startup.test.ts`：LIVE buffer + consumer + table[40] + 5 次一致性

`npm test` / `npx tsc --noEmit` 通过。
