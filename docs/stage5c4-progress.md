# Stage 5-C.4：恢复真实 cfunction.ext 初始化链

状态：**COMPLETE**（当时停在 table[14]；5-C.5 已接 memset）。**Stage 5-D NOT STARTED。**

未实现：code 6 helper、dummy P/R9、table[14] memset、table[3] memcpy、`_plat*`、Canvas/Audio/网络。

`src/abi` 无改动。`src/hot` 只修了 ARM BLX(1) decoder（JS 有符号比较把 `0xFA00977C` 当成 UNDEF/NV-skip）。

---

## BLX(1)

```text
编码     1111 101 H imm24     ARM 小端：7c 97 00 fa = 0xFA00977C
H        bit24 = 0            额外半字偏移，不是 T 标志
imm32    SignExtend(imm24:H:0) = 0x00977c<<2 = 0x25df0
target   Align(PC,4)+imm32
         PC=0x01e80014 → arch PC=0x01e8001c → 0x01ea5e0c
从 ARM： LR = inst+4 = 0x01e80018（无 Thumb bit）
         CPSR.T ← 1
```

独立 fixture：`test/blx-imm.test.ts`。Unicorn differential：`test/unicorn/diff.test.ts` **PASS**。

---

## 真实 cfunction.ext（孤立 + malloc，无 unknown-slot 陷阱）

```text
0x01e80008  ARM load
  BLX(1) 0xFA00977C
0x01ea5e0c  Thumb  (LR=0x01e80018)
  table[25]  _mr_c_function_new(0x01ea5e9d, 20)
  table[0]   mr_malloc(19956)
  table[14]  memset(0x0020021c, 0, 19952)  → MR_IGNORE（未实现）
  LDM {r4,pc}  ret=0
```

| 项 | 值 |
|---|---|
| dest+0 | `0x00010000` |
| dest+4 / P | `0x00200100` |
| helper | `0x01ea5e9d` |
| ER_RW | `0x0020021c` |
| rwLen | 19952 |
| R9 | `0`（load 路径不写；`arm_ext_call` 才写） |

`0x01ea5e0c` 是 BLX 目标 / 初始化体，**不是** helper。

---

## 完整 MythroadRuntime（strict）

二次 `800` 加载 cfunction 时 table[25]/[0] 已跑，table[14] 无 handler → `UNKNOWN_REQUIRED_SLOT = 14` → `800` catch `setExt(null)`。

**到不了** `_strCom(801, …, 6)`。

未实现 memset。未猜下一个 slot。

---

## 完成标准

```text
[x] BLX(1) 独立 CPU fixture
[x] Unicorn differential PASS
[x] cfunction.ext load 不再跳过 BLX
[x] table[25] 有动态证据
[x] P 由真实 guest 经 table[25] 初始化
[x] ER_RW 有实际值；R9 在 load 结束仍为 0
[x] helper 真实登记为 0x01ea5e9d（模块 helper；case 6 未进入）
[x] 新 first fault：UNKNOWN_REQUIRED_SLOT = 14
[x] npm test / tsc --noEmit
[x] Stage 3/4/5-A/5-B/5-C/5-C.1/5-C.2 regression
[x] src/abi 无改；src/hot 仅 decoder
[x] Stage 5-D NOT STARTED
```
