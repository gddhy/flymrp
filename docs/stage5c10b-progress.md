# Stage 5-C.10B：Minimal table[130] case 7 + Real MRP Re-run

状态：**COMPLETE**（只实现 `_mr_TestCom` **case 7**）。**未实现 table[38] / table[33]。Stage 5-D NOT STARTED。**

This is rxgj FULL compatibility behavior (`#ifdef MR_PLAT_DRAWTEXT` → `case 7: return input1`).  
It is not claimed to be universal Mythroad behavior.  
It is not a flymrp platform capability probe.

```text
REAL MRP BASELINE:
  deterministic: yes
  first production blocker: table[38]
  first post-130 blocker: table[38]
```

---

## Q&A

| | |
|---|---|
| **Q1** table130 case 7 是否已经真实实现？ | **是。** `mr_table[130]` → `_mr_TestCom(NULL, r1, r2)`，`input0==7` 返回 `input1` |
| **Q2** 是否严格只实现 case 7？ | **是。** 其它 `input0` → `UnknownAbiError` `unsupported TestCom case N`。无 default return 0 / input1 |
| **Q3** 真实 app 是否写入 ER_RW+0x1c = 0x270d？ | **是。** LIVE 读到 `0x270d`（guest `cmp/subs/str` 真实执行，不是 forensic 推断） |
| **Q4** 真实 app 是否越过原来的 slot130 blocker？ | **是。** 130 = `REAL_EXECUTED`，返回 `0x270f` |
| **Q5** 新的 first production blocker 是什么？ | **table[38]** |
| **Q6** 是否实际到达 table38？ | **是。** guest BLX 到 stub `0x00010098`，host 无 handler |
| **Q7** table33 是否实际到达？ | **否。** NOT REACHED |
| **Q8** 是否添加了任何 forensic bypass？ | **否。** 无 `cbRet` 越过 130/38/33。5-C.8/9 probe 也不再 skip 130 |

---

## 实现

```text
aex_t130:  _mr_TestCom(NULL, (int)r1, (int)r2)
input0 = R1
input1 = R2
R0 / R3 ignored

input0 == 7  → return input1     // rxgj FULL + MR_PLAT_DRAWTEXT
else         → UnknownAbiError   // family=_mr_TestCom
```

代码：`src/mythroad/mr-table.ts` `testCom`。inventory 只加 `mr_table/130/7`，不是整表 TestCom。

禁止项（本阶段均未做）：table[38] / platEx / `0x4c6` / 背光 / table[33] / getTime / Canvas / DrawText / network / fake MR_SUCCESS。

---

## 真实启动链（LIVE，无 bypass）

```text
app.mrp → start.mr → 601/800/801(1)/800/801(6)/801(0)
  → table[130] REAL_EXECUTED  R1=7 R2=0x270f → R0=0x270f
  → guest: cmp r0,r5 ; subs r0,#2 ; str r0,[r4,#0x18]
  → ER_RW+0x1c = 0x270d
  → table[14] REAL_EXECUTED  memset(ER_RW+0x1940, 0, 0x78)
  → table[38] STOP  NOT_EXECUTED by host
```

mr_table 生产调用序：

```text
25, 0, 125, 25, 0, 14, 130, 14, 38
```

（旧基线在 130 停下：`25, 0, 125, 25, 0, 14, 130`）

---

## STOP @ table[38]

| | |
|---|---|
| PC | `0x00010098` |
| CPSR | `0x60000010` |
| R0–R3 | `0x4c6`, `0`, `0`, `0` |
| R9 | `0x0020021c` |
| SP | `0x01e7ff98` |
| LR | `0x01ea666d` |
| [sp+0] / [sp+4] | `0` / `0` |
| owner | `gssjxz.mrp` |
| ARM insnCount | 135 |
| Lua insnCount | 71 |

---

## 进度表

```text
Stage              Status
--------------------------------
MRP parse           PASS
start.mr            PASS
mrc_loader.ext      PASS
cfunction.ext       PASS
cfunction init      PASS
code6               PASS
code0 entry         PASS
table130            PASS / REAL_EXECUTED
table14 post-130    PASS / REAL_EXECUTED
table38             BLOCKED
table33             NOT REACHED
```

---

## 确定性

连续 5 次真实 `app.mrp`：first unknown=38、PC、P/helper/ER_RW/rwLen、mr_table 序列、ARM 135、Lua 71 全部一致。

---

## 测试

| | |
|---|---|
| ABI | `test/real/testcom-130-abi.test.ts`（case 7 + 非 7 拒绝；R0/R3 忽略） |
| 启动 | `test/real/real-mrp-startup.test.ts` |
| CLI | `npx tsx tools/real/startup-baseline.ts test/fixtures/real/app.mrp` |

```bash
npm test
npx tsc --noEmit
```
