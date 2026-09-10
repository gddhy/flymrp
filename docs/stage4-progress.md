# Stage 4：EXT Runtime Integration

状态：实现完成，等待确认。  
范围：Stage 3 CPU 接入 ARM EXT ABI；独立加载并执行 EXT fixture。  
未接入：Lua / start.mr / MRP 主运行时 / Canvas / Audio / Scheduler / 完整 Mythroad API / JIT。  
Unicorn 仅存在于 `test/unicorn/`，不进 production bundle。

---

## 分阶段结果

### 4-A EXT Loader

| 项 | 内容 |
|---|---|
| implemented | `MRPGCMAP` / raw `+0/+4/+8` / 最小 ELF32 `PT_LOAD` 重定位；映射后 `+0` 写 table 指针；跑 `+8` `mr_c_function_load` |
| guest | 全部经过 `GuestMemory`，禁止 host pointer == guest pointer |
| tests | 4 |

### 4-B Guest memory

| 项 | 内容 |
|---|---|
| implemented | 主窗 32MB @ `0x00010000` + 低 64KB @ `0`（含 `EXT_STOP_ADDR`） |
| not mapped | platform / SCRRAM / VFD / IO / alt（fixture 未使用） |
| tests | 2 |

### 4-C R9 / ER_RW

| 项 | 内容 |
|---|---|
| implemented | 入口 `R9 = P.ER_RW`；`OwnerFrame` 栈在 call boundary 保存/恢复；GOT 用模块自己的 ER_RW |
| not | 每条指令 hook R9；单一 global module pointer |
| tests | 3 |

### 4-D 150-slot mr_table

| 项 | 内容 |
|---|---|
| implemented | `slot[n] = 0x10000 + n*4`；`execMask` + handler；SP-64 死区；`cb_ret`：`R0=ret, PC=LR, T=LR&1` |
| data slots | 23–24, 91–112, 135–136, 138–140, 142–143, 146 — LDR 当普通内存 |
| tests | 7 |

### 4-E host → EXT

| 项 | 内容 |
|---|---|
| implemented | `arm_ext_call`；R0=P R1=code R2=input R3=len R9=ER_RW SP=stack_top-16 LR=STOP |
| 路由 | code 1 + 独立 wrapper → **wrapper-first**；code 0–5 + primary → primary；code 2 + timer → timer；其余 active\|\|wrapper（**code 6/8 不走 0–5**） |
| tests | 5 |

### 4-F Bridge

| 项 | 内容 |
|---|---|
| implemented | 常数 / ADD R0+R1 / 读 stack arg / 写 output。未实现完整 Mythroad API |
| tests | 4 |

### 4-G Nested

| 项 | 内容 |
|---|---|
| implemented | wrapper / primary / active / timer / screen / current 六套 owner；2-level 与 3-level fixture |
| tests | 3 |

### 4-H Code cache

| 项 | 内容 |
|---|---|
| implemented | 每 `ExecRegion.generation`；ARM/Thumb 分表；写代码 / unload 只 bump 重叠 region，不全局清空 |
| tests | 3 |

### 4-I Stop / fault

| 项 | 内容 |
|---|---|
| kinds | `return`（命中 `EXT_STOP_ADDR`）/ `unsupported` / `unmapped` / `invalid-slot` / `abi-fault`；`stop` 保留给显式边界 API |
| not | Unicorn「异常即成功」 |
| tests | 6 |

### 4-J Differential

| 项 | 内容 |
|---|---|
| oracle | `test/unicorn/ext_oracle.py` |
| compare | R0–R15、CPSR NZCVT、PC、output / 指定内存 |
| tests | 7（ARM/Thumb entry、table、Thumb table、R9、stack ABI、nested table） |

### 4-K Bench（本机 Node）

| 项 | 结果 |
|---|---|
| Stage 3 `arm_add+cache` | **45.51 Mips**（基线 45.0，无回归） |
| Stage 3 `arm_add step` | 29.95 Mips |
| EXT direct call | 187.0 kcalls/s（5.35 µs/call） |
| EXT table / bridge | 205.4 kcalls/s（4.87 µs/call） |
| nested call | 120.5 kcalls/s |
| block-cache hit | 99.9%（999/1000） |
| code load | 663.3 kloads/s（poke + invalidate） |

Stage 4 桥慢于 CPU 热循环是预期；未改 interpreter 热路径。

---

## 明确不实现

```
Lua VM  start.mr  MRP main  Canvas  WebAudio  DOM
Scheduler  IndexedDB  full Mythroad API
VFP NEON MMU CP15 IRQ JIT eval/Function
```

---

## 如何跑

```bash
npm test
npx tsx bench/run.ts
```

## 完成计数

| 项 | 数量 |
|---|---|
| EXT fixture（`test/ext` + `test/unicorn/ext-diff`） | 45 |
| ARM 执行 fixture | 34 |
| Thumb 执行 fixture | 6 |
| table ABI fixture | 14 |
| nested fixture | 3（2-level / 3-level / R9 嵌套） |
| code-cache / invalidation | 3 |
| Unicorn EXT differential | 7/7 = **100%** |
| `npm test` | **91/91** |

Stage 4 停止。确认后再进入 Stage 5。
