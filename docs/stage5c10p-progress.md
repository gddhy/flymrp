# Stage 5-C.10P：table[9] `memcmp2` + Real MRP Re-run

状态：**COMPLETE**。实现 `mr_table[9]` `memcmp2`（rxgj `string.c` 逐 byte / early-exit / exact `*su1-*su2`）。**未实现** gzip / inflate / 新 slot。**Stage 5-D NOT STARTED。**

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

first production blocker:
  ARM_INSN_BUDGET
```

---

## Q1–Q19

| Q | 答案 | 标签 |
|---|---|---|
| **Q1** table9 identity/signature？ | `_mr_c_function_table[9] = memcmp2`。`int memcmp2(const void *cs, const void *ct, size_t count)`。源码 `src/mythroad/string.c`；声明 `include/mystring.h` | **CONFIRMED** |
| **Q2** 返回规则？ | `res = *su1 - *su2`（unsigned char 提升为 int 后相减）。**不是** `-1/0/1`。相等返回 0 | **CONFIRMED** |
| **Q3** signed 还是 unsigned？ | `const unsigned char *su1, *su2`。`0x80 - 0x7f = 1`，`0xff - 0x00 = 255` | **CONFIRMED** |
| **Q4** count=0 不访问 pointer？ | `string.c` 循环 `0 < count` 不进入；`aex_t009` 在 `r2==0` 时也不调用 compare。unmapped + n=0 → 0 | **CONFIRMED** |
| **Q5** early exit？ | 第一处 `res != 0` 即 `break`。byte0 不同且 byte1 unmapped → 不 fault | **CONFIRMED** |
| **Q6** LIVE R0/R1/R2 和 2-byte buffer？ | R0=`0x01e7fee8` R1=`0x01eadefc` R2=2。`[R0,R0+2)=1F 8B` `[R1,R1+2)=1F 8B`。R3=stub residue `0x00010024` | **CONFIRMED** |
| **Q7** LIVE memcmp2 返回？ | **0**（两笔都是） | **CONFIRMED** |
| **Q8** guest 如何消费？ | Thumb `CMP r0, #0` @ `0x01ea7d58`；`BEQ` → `0x01ea7d6c` 跳过 OLD_GZIP 第二次 compare | **CONFIRMED** |
| **Q9** 进入 gzip path？ | **是。** 第一笔 equal 后走 BEQ；第二笔同 magic 再 equal；随后 `table0(30196)` + 大量 memcpy | **CONFIRMED** |
| **Q10** table9 REAL_EXECUTED？ | **是。** 两笔 | **CONFIRMED** |
| **Q11** 新 first blocker？ | **ARM_INSN_BUDGET**。`DEFAULT_INSN_BUDGET=1000000`，`kind=abi-fault`，PC=`0x01ea1ee8` | **CONFIRMED** |
| **Q12** 分类？ | **CPU**。不是新 unknown slot。guest 仍在 inflate/memcpy 循环中前进（2956 次 table[3]） | **CONFIRMED**（停点/预算）；“再加大预算就能 unzip 完” **INFERRED** |
| **Q13** 新 gzip/unzip ABI？ | **否。** 无新 mr_table slot。inflate 在 guest 内，只调用已有 0/1/3/14 | **CONFIRMED** |
| **Q14** arm_ext_call(0) 返回？ | **否。** 以 `abi-fault` 回 host，不是 normal return | **CONFIRMED** |
| **Q15** Lua 恢复？ | **否。** lua insn 仍 71。`_strCom(801,...,0)` 未回 Lua | **CONFIRMED** |
| **Q16** 新 production sequence？ | 原 10O 前缀 + `9, 9, 0, 14, 0, 1, 14, 0×34, 14, 0×2, 3×2956`。总 hits=3035 | **CONFIRMED** |
| **Q17** 5 次 deterministic？ | **是。** blocker / memcmp / hits / P / helper / ER_RW / insn 相同 | **CONFIRMED** |
| **Q18** 其它新 ABI？ | **否。** 未实现 gzip/inflate/新 slot | **CONFIRMED** |
| **Q19** forensic bypass？ | **否** | **CONFIRMED** |

aex_t009 走宿主 libc `memcmp`，可能把差值夹成 `-1/0/1`。flymrp 按 `string.c` `memcmp2` 返回精确差值，不套 libc。当前 LIVE 两笔都是 0，夹不夹无差别。

---

## LIVE memcmp2

```text
#1  s1=0x01e7fee8  s2=0x01eadefc  n=2
    A=1F 8B  B=1F 8B  ret=0
    SP=0x01e7fee0  LR=0x01ea7d55
    CMP r0,#0 @ 0x01ea7d58  BEQ → 0x01ea7d6c

#2  s1=0x01e7fec8  s2=0x01eadefc  n=2
    A=1F 8B  B=1F 8B  ret=0
    另一栈帧，同一 GZIP_MAGIC 常量
```

`GZIP_MAGIC = "\037\213"`（`mr_gzip.h`）。payload `0x00206e6c` 前 16 字节仍是 `1F 8B 08 …`。

---

## 之后（不实现 unzip）

```text
table0(30196) memset(68)
table0(1548)  table1 free
table0 ×34    (36/60/108/…)
table3 ×2956  count 4–5，同一 LR 0x01ea1f83
STOP ARM_INSN_BUDGET @ 0x01ea1ee8  insn=1000000
```

无新 `UNKNOWN_REQUIRED_SLOT`。

```text
arm_ext_call(0):        returned to host? no (abi-fault)
_strCom(801,...,0):     returned to Lua?  no
Lua:                    resumed? no   insn=71
```

---

## Stage 5-C 收尾判断

```text
real _mr_readFile succeeds     yes
file backend closes cleanly    yes
memcmp2 gzip magic             yes / equal / gzip path entered
arm_ext_call(0) returns        no
Lua resumes                    no

Stage 5-C core startup path:
  pack file + directory + resource read + gzip detect = complete
  remaining blockers = ARM_INSN_BUDGET (CPU) during guest inflate
```

Stage 5-D：**NOT STARTED**。

---

## 如何跑

```bash
npx vitest run test/mythroad/memcpy2-strcmp2.test.ts test/real/real-mrp-startup.test.ts
npm test
npx tsc --noEmit
```
