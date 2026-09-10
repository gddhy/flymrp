# Stage 5-C.10O：registry-only table[1] / mr_free + Real MRP Re-run

状态：**COMPLETE**。实现 `mr_table[1]` registry-only compatibility free。**未实现** origin_mem first-fit / free-list / coalescing。**未实现** table[9] `memcmp2`。**Stage 5-D NOT STARTED。**

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
table9    BLOCKED / LIVE REACHED

first production blocker:
  table[9] memcmp2
```

This implementation validates and retires flymrp bump allocations
but does not reproduce rxgj origin_mem free-list reuse/coalescing.

It is sufficient for the currently observed startup path, which does
not depend on immediate address reuse.

flymrp intentionally traps known-pointer length mismatches instead of
simulating rxgj free-list corruption.

---

## Q1–Q21

| Q | 答案 | 标签 |
|---|---|---|
| **Q1** registry-only table1？ | 是。校验 live `guestAddr`+`size`，标记 `live=false`，`R0=MR_SUCCESS`。不复用、不回退 bump、不写 `{next,len}` | **CONFIRMED** |
| **Q2** exact pointer+len？ | `allocation.guestAddr === R0 && allocation.size === R1` | **CONFIRMED** |
| **Q3** NULL/invalid/already-free → SUCCESS？ | 是。不改其它 allocation。不抛 UnknownAbiError | **CONFIRMED** |
| **Q4** wrong len 严格 trap？ | 已知 live 指针 + 错误 len → `NativeAbiError`（`mr_free length mismatch`）。不是 rxgj 原生行为 | **CONFIRMED** |
| **Q5** 不复用地址？ | 是。下一笔 bump 在 heapTop 之后 | **CONFIRMED** |
| **Q6** LIVE TempName free？ | `R0=0x00206de0` `R1=132` registry exact match，`ret=0`，`liveAfter=false` | **CONFIRMED** |
| **Q7** LIVE indexbuf free？ | `R0=0x00205860` `R1=5500` headerWord=5496，exact match，`ret=0` | **CONFIRMED** |
| **Q8** LIVE table0(file_len)？ | table0(17178)=payload+4，raw=`0x00206e68` | **CONFIRMED** |
| **Q9** LIVE seek/read payload？ | seek SET 7065；read dest=`0x00206e6c` count=17174 ret=17174 | **CONFIRMED** |
| **Q10** payload == archive.data？ | 全长一致。前 16 字节 `1F 8B 08 …`（gzip） | **CONFIRMED** |
| **Q11** table41 REAL_EXECUTED？ | `mr_close(1)` ret=0，handle invalidated | **CONFIRMED** |
| **Q12** `_mr_readFile("res_lang0.rc")` 完整成功？ | **是。** name/pos/len/payload match/closed | **CONFIRMED** |
| **Q13** arm_ext_call(0) 返回 host？ | **否。** 停在 table[9] | **CONFIRMED** |
| **Q14** `_strCom(801,...,0)` 返回 Lua？ | **否** | **CONFIRMED** |
| **Q15** Lua 继续执行？ | **否。** lua insn 仍 71 | **CONFIRMED** |
| **Q16** 新 first blocker？ | **table[9]** `UNKNOWN_REQUIRED_SLOT = 9` | **CONFIRMED** |
| **Q17** 分类？ | **CORE_C_ABI**。`_mr_c_function_table[9] = memcmp2`。LIVE `memcmp2(0x01e7fee8, 0x01eadefc, 2)`，gzip magic 检测 | **CONFIRMED**（identity/LIVE）；unzip 后续 **INFERRED** |
| **Q18** 新 production sequence？ | 原 10M 序列 + `1, 1, 0, 45, 44, 41, 9` | **CONFIRMED** |
| **Q19** 5 次 deterministic？ | 是。P/helper/ER_RW/alloc/handle/payload/insn 相同 | **CONFIRMED** |
| **Q20** 其它新 ABI？ | **否。** 未实现 table[9] 或其它 slot | **CONFIRMED** |
| **Q21** forensic bypass？ | **否** | **CONFIRMED** |

---

## Compatibility simplification

```text
Valid flymrp bump allocations are retired from the live registry.
Address reuse / origin_mem free-list coalescing is not implemented.
Freed guest bytes are left unchanged (no poison / free-list metadata).
```

不要声称 `mr_free fully compatible` / `origin_mem implemented`。

---

## LIVE `_mr_readFile("res_lang0.rc")`

```text
name        res_lang0.rc
file_pos    7065
file_len    17174
table0      17178 @ 0x00206e68     header 17174 (guest wrap)
payload     0x00206e6c
read        17174 bytes, match archive.data[7065:24239]
close       handle 1 → 0, peek=null
```

guest 已完整自己读取真实 MRP resource。payload 是 gzip（`1F 8B 08`）。下一笔 table[9] 比较 2 字节，与 rxgj `mr_unzip.c` `memcmp2(magic, GZIP_MAGIC, 2)` 一致。

---

## Stage 5-C 收尾判断

```text
real _mr_readFile succeeds     yes
file backend closes cleanly    yes
arm_ext_call(0) returns        no
Lua resumes                    no

Stage 5-C core startup path:
  substantially complete for pack file + directory + resource read
  remaining blockers = table[9] memcmp2 (CORE_C_ABI), then likely unzip
```

Stage 5-D：**NOT STARTED**。

---

## 如何跑

```bash
npx vitest run test/mythroad/mr-free.test.ts test/real/real-mrp-startup.test.ts
npm test
npx tsc --noEmit
```
