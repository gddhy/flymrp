# Stage 3：独立 ARM/Thumb CPU 核心

状态：实现完成，等待确认。  
范围：GuestMemory + decoder + interpreter + BlockCache。  
未接入：MRP / Lua / Mythroad / 150-slot / Canvas / Audio / VFS / Scheduler。  
Unicorn 仅存在于 `test/unicorn/`，不进 production bundle。

---

## 分阶段结果

### 3-A GuestMemory

| 项 | 内容 |
|---|---|
| implemented | 主窗口 `ArrayBuffer` + `u8/u16/u32`；对齐快路径；未对齐按字节拼 LE；`read32Armv5` 旋转；额外 `map()`；越界 `MemoryFault` |
| unsupported | MRP 地址分类、table/screen/platform、缺页 dummy |
| tests | 7，全过 |
| limitations | Stage 3 只用一块连续 RAM（测试默认 `0..64KiB`） |

### 3-B ARM decoder

| 项 | 内容 |
|---|---|
| implemented | DP imm/reg/reg-shift；MUL 族；LDR/STR/B/H/SB/SH；LDM/STM；B/BL/BX/BLX；MRS/MSR；CLZ；SWP；SVC/BKPT；其余 → `UNDEF` |
| unsupported | 协处理器、media、特权、VFP/NEON |
| tests | 6，全过 |

### 3-C ARM interpreter

| 项 | 内容 |
|---|---|
| implemented | 上表全部执行；NZCV 仅 S/CMP 类更新；shift #0 = LSL 不变 / LSR#32 / ASR#32 / RRX；条件执行；R15 = PC+8；ALU 写 PC 不 interwork；BX/LDR/LDM PC interwork |
| tests | 12 单测 + Unicorn 对照 |
| differential | ALU/flag/shift#0/ADC/SBC/CMP/TST 手写用例 100%；随机 200 条 DP 100%；随机 80 条移位 ADD 100% |
| limitations | MULS 的 C/V 保持不变（对齐 Unicorn/QEMU）；STM 存 R15 = PC+12 |

### 3-D Thumb16

| 项 | 内容 |
|---|---|
| implemented | 移位、add/sub、imm ALU、高寄存器、BX/BLX、literal/SP/ADR、访存、PUSH/POP、LDMIA/STMIA、B/Bcond、extend/rev、CBZ、IT、SVC/BKPT |
| tests | 6，全过 |
| differential | adds / movs / ADD pc / 移位 / EOR / CMP 对齐 Unicorn |

### 3-E Thumb32

| 项 | 内容 |
|---|---|
| implemented | BL / BLX.W / B.W / Bcond.W；MOVW/MOVT；ADDW/SUBW；modified-imm 与 shifted-reg DP；LDR/STR.W 常用形；LDM/STM.W；CLZ.W；屏障当 NOP |
| unsupported | UBFX/BFI/SDIV/TBB/TBH/MRS.W 等 → trap |
| tests | 4，全过 |

### 3-F BlockCache

| 项 | 内容 |
|---|---|
| implemented | 每 `ExecRegion` 两张表：`blockIdArm[(pc-base)>>>2]` 与 `blockIdThumb[(pc-base)>>>1]`。同一地址 ARM/Thumb 不会复用。IT 活跃时不走 cache。 |
| tests | 4，全过（含同地址分表、半字粒度、unsigned `findRegion`、invalidate） |

### 3-G Differential + bench

| 项 | 内容 |
|---|---|
| tests | 7 个 Unicorn 对照文件，全部通过 |
| pass rate | 已跑对照 **100%**（随机 DP 200 + 移位 80 + 手写 ALU/LDR/Thumb/MUL/B/BX） |
| bench (Node, 本机) | `arm_add+cache` **45.0 Mips**；`arm_add step` **31.3 Mips**（1e6 ADD，解释器，无 JIT） |

---

## 指令清单

**已实现（user-mode 子集）**

```
AND EOR SUB RSB ADD ADC SBC RSC
TST TEQ CMP CMN ORR MOV BIC MVN
MUL MLA UMULL UMLAL SMULL SMLAL
LDR STR LDRB STRB LDRH STRH LDRSB LDRSH
LDM STM  B BL BX BLX
MRS MSR(flags)  CLZ  SWP SWPB
Thumb16 常用全集（含 IT/CBZ/extend/rev）
Thumb32：BL/BLX/B.W/MOVW/MOVT/ADDW/SUBW/DP.W/LDR.W/LDM.W/CLZ.W
```

**明确不实现 / trap**

```
VFP NEON Jazelle
privileged / system / IRQ / MMU / CP15
协处理器、ARMv6 media
LDM/STM S 位（SPSR）
未列出的 Thumb-2
```

---

## 已知限制

1. 这是 **ARMv5TE 风格 user-mode**，不是通用 ARM。
2. ALU 写 PC 不切 T；BX/BLX/LDR/LDM→PC 才 interwork。
3. 未对齐 LDR 用 ARMv5 ROR；STR 对齐到字。
4. 无 JIT、无 MRP、无 table bridge。
5. Unicorn oracle 必须 **先写 CPSR 再写寄存器**，否则 banked SP/LR 对不齐。
6. Block cache key = `(region, T-state, 对齐索引)`，不是裸 `(pc-base)>>>2`。

---

## 如何跑

```bash
npm test
npx tsx bench/run.ts
```

Stage 3 停止。确认后再进入后续阶段（仍不要接 MRP，除非明确进入 Stage 4）。
