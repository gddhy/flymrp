# Stage 5-C.10R：Real MRP Post-Inflate Continuation / Startup Completion Gate

状态：**COMPLETE**（取证）。guest inflate 在生产 watchdog 下完整结束。`arm_ext_call(0)` / Lua **未**恢复。**未实现**任何新 ABI。**Stage 5-C NOT COMPLETE。Stage 5-D NOT STARTED。**

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
guest inflate  PASS  (POP 0x01ea1e96 @ insn 1,102,310; output == reference gunzip)

first production blocker:
  table[30]  mr_getCharBitmap  UNKNOWN_REQUIRED_SLOT
  category: EXT_ABI
```

---

## Q1–Q19

| Q | 答案 | 标签 |
|---|---|---|
| **Q1** 当前 production watchdog 是否越过旧 1M stop？ | **是。** 默认 watchdog=2,000,000。实际 insn=1,404,897。1M 低 budget 仍停在 `0x01ea1ee8` | **CONFIRMED** |
| **Q2** guest inflate 是否完整完成？ | **是。** 不是“离开 0x01ea1ee8”。证据：函数 `0x01ea1d28` 在 `0x01ea1e96` `POP {r4-r7,pc}` 返回（lastInside `0x01ea1e94` / LR=`0x01ea1f83` / insn=1,102,310）；之后 37 次 table[1] 拆除 huft scratch；后续 caller `0x01eaadaa` 已在 inflate 函数外 | **CONFIRMED** |
| **Q3** inflate output pointer/length？ | raw in=`0x00206e6c` len=17174（`res_lang0.rc` stored）。out alloc=`0x0020b188` size=30196；header u32le=30192；payload @ +4 | **CONFIRMED** |
| **Q4** 与 reference gunzip 一致？ | **是。** SHA-256 `6b08cf46dbd5b6dbe32ce68a3d552107c2af27fa91724b41992901953a033235` 两边相同；30192 字节。host gunzip **仅 oracle** | **CONFIRMED** |
| **Q5** inflate 期间是否有新 ABI？ | **否。** 只观察到已有 slot：0 / 1 / 3 / 14 / 9。无 gzip host ABI | **CONFIRMED** |
| **Q6** `arm_ext_call(0)` normal return？ | **否。** 同一 call 撞上 table[30] | **CONFIRMED** |
| **Q7** `_strCom(801,...,0)` 回 Lua？ | **否。** 最后一笔 `ok=false`，`UNKNOWN_REQUIRED_SLOT = 30` | **CONFIRMED** |
| **Q8** Lua 是否恢复？ | **否。** lua insn 仍 71；仍在 C `_strCom` 内 | **CONFIRMED** |
| **Q9** Lua 恢复后的第一批真实调用？ | **无。** Lua 未恢复。无 `_com` / graphics / timer / event | **CONFIRMED** |
| **Q10** 新 first production blocker？ | **table[30]** `mr_getCharBitmap`。PC=`0x00010078` LR=`0x01eaadad` R0=`0x662f` R1=0 R2=`0x01e7ff7c` R3=`0x01e7ff78` | **CONFIRMED** |
| **Q11** blocker category？ | **EXT_ABI**。未实现的 `mr_table` slot。语义是 font glyph（TEXT），但仍在 `arm_ext_call(0)` 初始化内，不是 Lua 图形运行时 | **CONFIRMED** |
| **Q12** 是否已进入 graphics/timer/event？ | **否。** graphics commands=0。无 TimerStart / event | **CONFIRMED** |
| **Q13** Stage 5-C completion gate？ | **不满足。** inflate PASS，但 `arm_ext_call(0)` / `_strCom(801,0)` / Lua resume 均为 BLOCKED/NOT REACHED。blocker 仍是 EXT_ABI | **CONFIRMED** |
| **Q14** 是否建议进入 Stage 5-D？ | **否。** 下一工作仍是 5-C 核心兼容（table[30]），不要开始 5-D | **CONFIRMED** |
| **Q15** 5 次 deterministic？ | **是。** thrown / slot / insn / lua insn / P / helper / ER_RW / bump / live / hash / RLE / R0 全同 | **CONFIRMED** |
| **Q16** startup insn / wall / Mips？ | insn=1,404,897；wall ≈ 280–300ms；≈ 4.7–5.0 MIPS。未优化 | **CONFIRMED** |
| **Q17** 是否新增任何 ABI？ | **否** | **CONFIRMED** |
| **Q18** 是否使用 forensic bypass？ | **否** | **CONFIRMED** |
| **Q19** 是否使用 host gunzip in production？ | **否。** production = guest ARM inflate。oracle = 测试对照 | **CONFIRMED** |

---

## Inflate 完成证据（不只是离开 1M PC）

```text
inflate fn     0x01ea1d28   PUSH {r4-r7,lr}
1M landmark    0x01ea1ee8   仍在 huft extra-bits 循环（C.10Q）
fn return      0x01ea1e96   POP {r4-r7,pc}
lastInside     0x01ea1e94   LR=0x01ea1f83  insn=1,102,310
teardown       table[1] ×37  huft/scratch free
next caller    0x01eaadaa   BLX r7  → table[30]
               LR=0x01eaadad  fn=0x01eaad6c
output live    0x0020b188  header=30192  payload==oracle
gzip input     0x00206e6c  alloc 17178  freed
```

guest inflate completed: **yes**

---

## 内存生命周期

```text
mrAllocs=44  liveAllocs()=2  bump=0x00215058
output 30196 仍 live（后续 getCharBitmap caller 还在读解压结果）
gzip raw 17178 freed
huft scratch（36/60/108/396/780/1548/6156）freed
无 inner-loop runaway alloc；增长是有限初始化
registry-only free 不复用地址，bump 前进不判错
```

---

## mr_table sequence（RLE）

完整 3549 hits，可还原：

```text
25,0,125,25,0,14,130,14,38,33,17,40,14,44,0,45,44,0,3x2,10,3x2,10,3x2,10,3x2,1x2,0,45,44,41,9x2,0,14,0,1,14,0x34,14,0x2,3x3432,1x37,30
```

`9x2` = gzip magic memcmp2。`3x3432` = inflate 内 memcpy2。`1x37` = inflate 返回后拆除。`30` = blocker。

---

## Stage 5-C completion gate

```text
real pack open/read/seek/close       PASS
directory parsing                    PASS
resource lookup                      PASS
gzip detect                          PASS
guest inflate                        PASS
arm_ext_call(0) normal return        BLOCKED
_strCom(...,0) returns Lua           BLOCKED
Lua resumes                          NOT REACHED

Stage 5-C:
  NOT COMPLETE

recommended next:
  remain in Stage 5-C (table[30] EXT_ABI)
  do not start Stage 5-D
```

table[30] 语义是 TEXT/font，但当前停在未实现的 `mr_table` 槽，且 Lua 尚未恢复。按本阶段规则归 **EXT_ABI**，不是 graphics runtime 入口。

---

## Unicorn 归档（C.10Q，本阶段不重跑）

最终有效 differential：

```text
valid setup:
  R9 restored = 0x00200294
  table stub execution counted

alignment:
  uniCount = guestInsns + tableStubs

windows:
  100 / 1000 / 10000

match:
  PC
  R0-R14
  CPSR
```

以下 early runs **superseded / invalid**，不进入 CPU 正确性结论：

```text
- interrupted 1M / raw-gzip oracle
- first Unicorn run with wrong R9
- pre-table-stub-count alignment “PC off by 1”
```

---

## 未实现

```text
table[30] mr_getCharBitmap
gzip / inflate host ABI
新 mr_table / _strCom / _com / graphics / timer
forensic cbRet
Stage 5-D
```

---

## 如何跑

```bash
npx vitest run test/real/post-inflate-startup.test.ts
npx vitest run test/real/inflate-budget.test.ts
npm test
npx tsc --noEmit
```
