# Stage 5-C.10M：Implement confirmed core C ABI — table[3] memcpy2 + table[10] strcmp2

状态：**COMPLETE**。实现 table[3] / table[10]。**未实现** table[1] mr_free。**未改** file backend。**未加** forensic bypass。**Stage 5-D NOT STARTED。**

```text
table130  PASS / REAL_EXECUTED
table38   PASS / REAL_EXECUTED
table33   PASS / REAL_EXECUTED
table17   PASS / REAL_EXECUTED
table100  PASS / DATA SLOT
table40   PASS / REAL_EXECUTED
table44   PASS / REAL_EXECUTED
table45   PASS / REAL_EXECUTED
table41   NOT REACHED
table3    PASS / REAL_EXECUTED
table10   PASS / REAL_EXECUTED
table1    BLOCKED / LIVE REACHED

first production blocker:
  table[1]

production mr_table:
  25, 0, 125, 25, 0, 14, 130, 14, 38, 33, 17,
  40, 14, 44, 0, 45, 44, 0,
  3, 3, 10,
  3, 3, 10,
  3, 3, 10,
  3, 3,
  1
```

---

## Q1–Q17

| Q | 答案 | 标签 |
|---|---|---|
| **Q1** table3 是否实现为真实前向 memcpy2？ | **是。** `read8(src+i)` 立刻 `write8(dst+i)`。`count==0` 先 return dest。地址/`count` 用 `>>> 0` | **CONFIRMED** |
| **Q2** 是否证明不等于 memmove？ | **是。** `[1,2,3,4,5]` src=0 dst=1 count=4 → `[1,1,1,1,1]`。TypedArray.set 对照得到 `[1,1,2,3,4]` | **CONFIRMED** |
| **Q3** count=0 是否不访问 pointer？ | **是。** unmapped dest/src + count=0 不抛 `MemoryFault`，返回 dest | **CONFIRMED** |
| **Q4** LIVE 第一笔 len=9 是否成功复制？ | **是。** dst=`0x01e7ff34` src=`0x00205864` count=4；dst bytes `09 00 00 00`；guest 当 `len=9` | **CONFIRMED** |
| **Q5** 是否 LIVE 到第二次/后续 table3？ | **是。** 第二笔 dst=`0x00206de4` src=`0x00205868` count=9 → `"start.mr\0"`。目录循环共 8 笔 table3 | **CONFIRMED** |
| **Q6** table10 是否实现？ | **是。** `mr_table[10] = strcmp2`。逐 byte `read8`，first-diff 即停 | **CONFIRMED** |
| **Q7** strcmp2 是否返回精确 -1/0/1？ | **是。** rxgj `string.c` 用 `unsigned char c1,c2`，`c1<c2 ? -1 : 1`。guest `-1` = `0xffffffff`。`0x80 > 0x7f` | **CONFIRMED** |
| **Q8** guest 是否真实扫描 MRP directory？ | **是。** 未走 `archive.getResource`。扫到 `start.mr` / `mrc_loader.ext` / `res_lang0.rc` | **CONFIRMED** |
| **Q9** 是否找到 res_lang0.rc？ | **是。** 第三次 strcmp 返回 0 | **CONFIRMED** |
| **Q10** guest 解出的 file_pos/file_len 是否与 MRPArchive 一致？ | **是。** file_pos=**7065** file_len=**17174** = `entries["res_lang0.rc"].offset/storedLength` | **CONFIRMED** |
| **Q11** 新 first production blocker 是什么？ | **table[1]** `UNKNOWN_REQUIRED_SLOT = 1` | **CONFIRMED** |
| **Q12** table1 是否 LIVE 到达？ | **是。** 本笔是 free TempName scratch，不是 indexbuf | **CONFIRMED** |
| **Q13** 是否实现 table1？ | **否。** 无 no-op / fake free / registry delete | **CONFIRMED** |
| **Q14** table41 是否 LIVE 到达？ | **否。** NOT REACHED。未为验证 close 跳过 table1 | **CONFIRMED** |
| **Q15** 新 production mr_table sequence？ | 见文首。load + code0 完整 hits 以 table[1] 结束 | **CONFIRMED** |
| **Q16** 5 次启动是否 deterministic？ | **是。** fingerprint 5 次相同 | **CONFIRMED** |
| **Q17** 是否添加 forensic bypass？ | **否。** 无 cbRet / 无 host libc / 无 TextDecoder strcmp / 无 memmove substitute | **CONFIRMED** |

---

## 实现

`src/mythroad/mr-table.ts`：

```text
table[3]  memcpy2(dest, src, count)
  if count==0: return dest
  for i in 0..count-1:
    write8(dst+i, read8(src+i))
  return dest

table[10] strcmp2(cs, ct)
  unsigned char 逐 byte
  first difference → -1 / 1
  both NUL → 0
```

源码：rxgj `src/mythroad/string.c`（Linux `lib/string.c` 拷贝）。`strcmp2` **CONFIRMED** 使用 `unsigned char`，不是 signed `char` 直接比较。

禁止项（本阶段遵守）：

```text
TypedArray.set / slice+set / copyWithin / memmove
TextDecoder / localeCompare
table[1] / table[4] / 其它新 slot
file backend 修改
forensic bypass
```

---

## LIVE 第一笔 table3（len）

```text
R0 dst      0x01e7ff34
R1 src      0x00205864
R2 count    4
src/dst     09 00 00 00
return      dest
→ guest len = 9
```

## LIVE 第二笔 table3（TempName）

```text
dst         0x00206de4     TempName user ptr
src         0x00205868     indexbuf+4
count       9
bytes       "start.mr\0"
```

## LIVE table10（目录扫描）

| # | R0 | R1 TempName | ret |
|---|---|---|---|
| 1 | `res_lang0.rc` | `start.mr` | **-1** (`0xffffffff`) |
| 2 | `res_lang0.rc` | `mrc_loader.ext` | **1** |
| 3 | `res_lang0.rc` | `res_lang0.rc` | **0 MATCH** |

visited = 3。未把全部 entry 打到测试日志。

## LIVE file_pos / file_len（命中后两笔 count=4 memcpy）

```text
file_pos  LE 153 27 0 0  = 7065  = 0x1b99   dst 0x01e7ff0c
file_len  LE 22 67 0 0   = 17174 = 0x4316   dst 0x01e7ff30
```

与 host `MRPArchive.entries` 中 `res_lang0.rc` 一致。guest 自己从 index bytes 拷出，没有 `getResource`。

## LIVE table[1]（未实现）

```text
stub PC     0x00010004
LR          0x01ea7ac7     (free wrap 0x01ea7ab4，BLX 0x01ea7ac4)
SP          0x01e7ff00
CPSR        0x00000010
insn        507
R0          0x00206de0     header（wrap 已 SUB #4）
R1          132            = 128+4
R2          0x00010004
R3          0x0001000c
R5          1              pack handle
R6          0x01e7ff74     "res_lang0.rc"
R7          0x00206de4     TempName user
header[R0]  128            原始 malloc 请求 0x80
user ptr    R0+4 = TempName
return consumer:
  none / not executed
```

这是 **free TempName scratch**。静态链上 indexbuf 的 table1 是下一笔，本阶段未到。

---

## Inventory

```text
mr_table/3/memcpy2
  forward byte-copy semantics
  not memmove

mr_table/10/strcmp2
  guest byte-string strcmp2
  returns -1/0/1
```

不要写成 `libc memcpy/strcmp fully supported`。

---

## 测试

```text
npm test
npx tsc --noEmit
```

新增：`test/mythroad/memcpy2-strcmp2.test.ts`（含 overlap regression）。

Stage 5-D：**NOT STARTED**。
