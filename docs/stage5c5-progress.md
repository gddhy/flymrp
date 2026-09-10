# Stage 5-C.5：CONFIRMED table[14] memset ABI

状态：**COMPLETE**（停在 table[130]）。**Stage 5-D NOT STARTED。**

只实现已确认的 `table[14] = memset2`。未实现：其它 table slot、host code 6 helper、dummy P/R9、`_plat*`、Canvas/Audio/网络。

---

## ABI（CONFIRMED）

rxgj `src/mythroad/string.c` `memset2` + `mythroad.c` `_mr_c_function_table[14]` + 真实 guest 调用：

```text
table[14]  memset(dest, value, length)
r0         guest dest          → 返回 dest（void *s）
r1         byte value          → 只用低 8 位
r2         byte length         → size_t（>>> 0）
memory     GuestMemory.fill    不假设 guest == host
越界       现有 MemoryFault / ExtStopKind.Unmapped
length=0   不写，仍返回 dest
```

---

## 真实链

```text
cfunction.ext load
  BLX(1) → Thumb 0x01ea5e0c
  table[25] → P=0x00200100 helper=0x01ea5e9d
  table[0]  mr_malloc(19956)
  table[14] memset(0x0020021c, 0, 19952) → dest
  ret=0

_strCom(801, {1, 1968}, 6)
  arm_ext_call(6)
    PC=0x01ea5e9c Thumb  r0=P  r1=6  r9=ER_RW
    kind=return r0=0
    ER_RW+0x10 = 0x7b0 (1968)
    ER_RW+0x20 = 0

_strCom(801, "", 0)
  arm_ext_call(0)
  table[130] r0=0 r1=7 r2=0x270f
  STOP  UNKNOWN_REQUIRED_SLOT = 130
```

`table[130]` 源码身份是 `asm_mr_TestCom`。**只记录，不实现。**

未实现 host code 6 helper。guest helper 已经自己跑完。

---

## 完成标准

```text
[x] table[14] memset handler
[x] 独立 GuestMemory 测试
[x] 真实 cfunction load 完成
[x] 下一处 first fault = table[130]
[x] 不实现其它 slot / code 6 / 5-D
[x] npm test / tsc
```
