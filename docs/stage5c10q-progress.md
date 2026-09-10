# Stage 5-C.10Q：ARM_INSN_BUDGET Forensics + Real Guest Inflate

状态：**COMPLETE**。guest inflate 在 guest ARM/Thumb 内完成。**未实现** gzip / inflate host ABI / 新 slot / table[30]。生产 ARM watchdog 改为可配置：默认 **2,000,000**，上限 **20,000,000**。**Stage 5-D NOT STARTED。**

```text
table130  PASS / REAL_EXECUTED
table38   PASS / REAL_EXECUTED
table33   PASS / REAL_EXECUTED
table17   PASS / REAL_EXECUTED
table100  PASS / DATA SLOT
table40   PASS / REAL_EXECUTED
table44   PASS / REAL_EXECUTED
table45   PASS / REAL_EXECUTED
table41   PASS / REAL_EXECUTED
table3    PASS / REAL_EXECUTED
table10   PASS / REAL_EXECUTED
table1    PASS / REAL_EXECUTED
table9    PASS / REAL_EXECUTED
guest inflate  PASS  (1,404,897 insns; output == reference gunzip)

first production blocker:
  table[30]  mr_getCharBitmap  UNKNOWN_REQUIRED_SLOT
```

---

## Q1–Q18

| Q | 答案 | 标签 |
|---|---|---|
| **Q1** 1M stop 是 CPU bug 还是人工 watchdog？ | **人工 watchdog。** 1M 只跑 ~290ms / ~3.3 MIPS。提高 budget 后 guest 继续前进并完成 inflate | **CONFIRMED** |
| **Q2** PC `0x01ea1ee8` 是什么？ | Thumb。函数起于 `0x01ea1d28`（PUSH）。当前块是 huft extra-bits 循环：`LDRB` + `CMP #0x10` + 回跳。同函数内 `BLX r3` @ `0x01ea1f80`，LR=`0x01ea1f83`，对应 `memcpy2(slide+w, slide+d, e)` | **CONFIRMED** guest inflate inner loop |
| **Q3** 1M→2M→5M→10M 是否持续前进？ | 1M：prefix=26852/30192。2M：inflate 完成，insn=1404897，下一状态 table[30]。5M：与 2M **同一** guest 状态。未再跑 10M/20M（已到真实下一状态） | **CONFIRMED** |
| **Q4** 有无循环不前进？ | **无。** 输出游标与 reference gunzip 前缀同时单调增加。SP 在 inflate 阶段稳定。不是 ping-pong / 死循环 | **CONFIRMED** |
| **Q5** Unicorn differential？ | 从 1M 停点（恢复 guest R9=`0x00200294`）跑 100 / 1000 / 10000。对齐 table stub 计数（flymrp 不把 stub 算进 insn）后 **PC / R0–R14 / CPSR 全匹配** | **CONFIRMED** |
| **Q6** unsupported / invalid decode？ | **无。** 1M 工作集 UNDEF=0。完成 inflate 未触发 UnsupportedInsn / MemoryFault | **CONFIRMED** |
| **Q7** inflate 需要多少 instructions？ | **1,404,897**。区间：1,000,000 失败（仍在 inflate）→ 1,404,897 到达 table[30] | **CONFIRMED** |
| **Q8** guest inflate 是否完成？ | **是。** 输出 30192 字节；alloc 30196 = `u32le(len) + payload` | **CONFIRMED** |
| **Q9** 与 reference gunzip 一致？ | **是。** Node `zlib.gunzipSync(raw res_lang0.rc)` = 30192；guest `outBuf+4` 逐字节相等。host gunzip **仅验证** | **CONFIRMED** |
| **Q10** `arm_ext_call(0)` normal return？ | **否。** inflate 完成后同一 call 撞上 table[30]，抛 `UNKNOWN_REQUIRED_SLOT = 30` | **CONFIRMED** |
| **Q11** `_strCom(801,...,0)` 回 Lua？ | **否。** 最后一笔仍 `ok=false`，错误改为 slot 30 | **CONFIRMED** |
| **Q12** Lua 是否恢复？ | **否。** lua insn 仍 71 | **CONFIRMED** |
| **Q13** 新 first production blocker？ | **table[30]** | **CONFIRMED** |
| **Q14** 新 blocker 类别？ | **ABI / UNKNOWN_REQUIRED_SLOT**。rxgj `_mr_c_function_table[30] = asm_mr_getCharBitmap`。LIVE R0=`0x662f`（字码），PC=`0x00010078`，LR=`0x01eaadad`。不是 CPU / gzip | **CONFIRMED** |
| **Q15** production watchdog 怎么调？ | 采用 **方案 B**：`ExtRuntime.insnBudget` + `MythroadRuntime.armInstructionBudget`。默认 **2,000,000**（本 fixture 需 1.40M）。有限上限 **20,000,000**。不是固定写死 20M，也未做 slice | **CONFIRMED** |
| **Q16** watchdog 与 browser slice 分离？ | **是。** `insnBudget` 只是 safety/debug 有限上限。execution slice **未实现**，本阶段不改 `arm_ext_call` 同步语义 | **CONFIRMED** |
| **Q17** 是否实现 gzip / 新 ABI？ | **否。** 无 zlib/pako/CompressionStream/新 slot/新 libc。host gunzip 只在 forensic/test 对照 | **CONFIRMED** |
| **Q18** 5 次 deterministic？ | **是。** 5×2M：insn=1404897、slot=30、PC/LR/R0、prefix=30192、hits=3549 全同。5×5M 与 2M 相同。既有 5×1M 停点仍 deterministic | **CONFIRMED** |

---

## Budget sweep

```text
budget=1000000  insn=1000000  kind=abi-fault
  PC=0x01ea1ee8  CPSR=0x80000030  SP=0x01e7f918  LR=0x01ea1f83  R9=0x00200294  T=1
  hits=3035  t0=43  t1=3  t3=2964  t9=2
  outBuf=0x0020b188  dataOff=4  cursor~26850  prefix=26852/30192
  wall~290ms  ~3.3 MIPS  Lua insn=71

budget=2000000  insn=1404897  thrown=UNKNOWN_REQUIRED_SLOT = 30
  PC=0x00010078  LR=0x01eaadad  R0=0x662f  R9=0x00200294
  hits=3549  t0=43  t1=40  t3=3440  t9=2
  prefix=30192/30192  equal  outputVerified
  live allocs 39→2  (inflate scratch freed)
  wall~280ms  Lua insn=71  arm_ext_call(0) not returned

budget=5000000  与 2M 同一 guest 状态（insn/PC/LR/slot/prefix/hits）
```

At 1M: prefix 26852/30192，table3-in-window 2956，仍在 huft/copy 循环。  
At 2M: inflate 完成，下一状态 table[30]。  
At 5M: 与 2M 相同。不是死循环。

---

## PC 0x01ea1ee8

```text
mode     Thumb
fnStart  0x01ea1d28   PUSH {r4-r7,lr}  (decoder: STM)
stop     0x01ea1ee8   LDR r0, [sp, #8]
nearby   LDRB / CMP #0x10 / BLS  → huft extra-bits (e > 16)
memcpy   0x01ea1f80   BLX r3     LR=0x01ea1f83
after    ADD r7, r6              w += e
```

LIVE table[3] dest/src 落在 `outBuf=0x0020b188` 窗口内。inflate 归属 **CONFIRMED**。

---

## CPU health

```text
SP inflate 阶段稳定（min==max）
LR  inflate 阶段仅见 0x01ea1f83
R9  0x00200294（ER_RW）；arm_ext_call 返回后会恢复 wrapper R9，取证需在 runGuest 返回前快照
T    一直为 1
code writes 落在 cfunction 映像（含 RW data），不是 self-modifying inner loop
无 table stub 当普通代码、无 dummy/UNDEF
```

1M 解码工作集：359 blocks / 2013 insns；ARM 11、Thumb16 1963、Thumb32 39；UNDEF 0。

---

## Unicorn window（1M 停点）

最终有效 differential（C.10R 归档，不重跑）：

```text
valid setup:
  R9 restored = 0x00200294
  table stub execution counted

alignment:
  uniCount = guestInsns + tableStubs
```

早期失败 run **superseded / invalid**，不进入 CPU 正确性结论：interrupted 1M/raw-gzip oracle；wrong-R9 Unicorn；对齐前 “PC off by 1”。

对齐：unicorn 每进一次 table stub 会执行 `BX LR`（计 1 条），flymrp intercept 不计。`uniCount = guestInsns + tableStubs`。

```text
100    tableStubs=1   uniCount=101    match
1000   tableStubs=5   uniCount=1005   match
10000  tableStubs=37  uniCount=10037  match
```

PC / R0–R14 / CPSR 一致。**CONFIRMED**。

---

## 性能（未做重构）

```text
1M inflate 中段   ~290ms   ~3.3 MIPS
2M 到 table[30]   ~280ms   ~5.0 MIPS  (1.40M insn)
table bridge      毫秒级，不是主耗时
GuestMemory       未单独计时，含在 CPU 时间内
```

1M 作为默认值只是旧安全阈值。10M 死循环大约会堵 JS 主线程数秒；因此默认只升到 2M，并把 watchdog 与未来 slice 分开。

---

## Watchdog 方案

| 方案 | 决定 |
|---|---|
| A 固定 10M | 不采用。对本 fixture 过大，对其它 MRP 仍是任意数 |
| **B 可配置 watchdog** | **采用。** `DEFAULT_INSN_BUDGET=2e6`，`MAX_INSN_BUDGET=20e6`，`MythroadRuntime.armInstructionBudget` 可覆盖 |
| C execution slice | 记录为未来 Web runtime 方向。本阶段不实现（会改同步 `arm_ext_call`） |

`insnBudget` = 防死循环的 finite watchdog。  
slice = 浏览器让出 event loop。两者不是同一个变量。

---

## 未实现

```text
gzip / inflate host ABI
zlib / pako / CompressionStream
table[30] mr_getCharBitmap
新 mr_table slot
新 libc ABI
forensic cbRet
CPU instruction guessing
file / allocator / memcpy / memcmp 行为改动
Stage 5-D
```

---

## 如何跑

```bash
npx tsx tools/real/forensics-budget.ts test/fixtures/real/app.mrp --budgets 1000000,2000000
FLYRMP_HEAVY=1 npx vitest run test/unicorn/inflate-window-diff.test.ts
npx vitest run test/real/inflate-budget.test.ts test/real/real-mrp-startup.test.ts
npm test
npx tsc --noEmit
```
