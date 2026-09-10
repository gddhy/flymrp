# Stage 5-C.2：Real EXT Loader ABI Wiring

状态：**COMPLETE**。**Stage 5-D NOT STARTED。**

未改：`src/hot`、`src/abi`。未实现：`_plat*`、未知 `_com`、GUI/audio/network、Canvas、DRM、`mr_free`（table[1]）。

本阶段只接两个已由真实执行 + Mythroad ABI 确认的 slot：

```text
table[0]   = mr_malloc
table[125] = _mr_readFile
```

---

## table[0]

`mr_malloc(size)` 复用现有 EXT bump heap（`ExtRuntime.alloc`，8 字节对齐）。

* size=0 → 0
* 越界（`heapTop + aligned > EXT_STACK_ADDR`）→ 0
* 返回 guest pointer，不是 `MR_IGNORE=1`，不是 JS host pointer
* 记录 `{size, alignedSize, guestAddr, owner}`
* 未实现 `mr_free`（无本阶段所需的第三槽）

Guest STR/LDR round-trip 已测。

---

## table[125]

`_mr_readFile(filename, filelen*, lookfor)` 走现有 VFS，不硬编码 `cfunction.ext` 内容。

* lookfor=1：exists → 1/0
* lookfor=0 或 2：`vfs.readFile`（已 inflate）→ malloc + 拷进 guest + 写 length
* 其它 lookfor → 0
* 文件名从当前 EXT guest C 字符串读取（`MR_MAX_FILENAME_SIZE=128`）

`_strCom` / `mrp_tostring_t` 的 `{ptr,len}` 仍从**当前** EXT guest 切片（5-C.1 plumbing）。`800`/`802` 先 `setExt` 再 `load()`，保证 load 期间 0/125 已接线。

---

## 真实 `app.mrp`

```text
start.mr
  → _strCom(601) mrc_loader.ext
  → _strCom(800) r0=3
  → _strCom(801,"",1)
  → table[0] / table[125]
  → cfunction.ext 220596B 读入 guest
  → _strCom(800, {ptr,len}) loadCode=0 ret=0
  → _strCom(801, {1, vmver}, 6)
  → STOP
```

* `mrc_loader.ext`：pass
* `cfunction.ext`：loaded（`mrReads` length=220596，`ext.codeLen=220596`）
* `unknownRequiredSlot`：无（未出现第三槽）
* 第一个真实失败：`_strCom(801)` code **6** → `arm_ext_call(6)` → `kind=abi-fault`（`routeCall(6)` 的 p/helper 均为 0；cfunction `mr_c_function_load(0)` 未走 table[25] 登记 helper）

未为 code 6 / helper 登记猜实现。未进入 5-D。

---

## 测试

| 文件 | 内容 |
|---|---|
| `test/mythroad/mr-table.test.ts` | malloc 对齐/越界、guest R/W、readFile 存在/缺失/lookfor=1 |
| `test/real/loader-abi.test.ts` | 当时：loader → cfunction → 801/6 abi-fault。5-C.4 起停在 table[14] |

```bash
npx tsx tools/real/inspect.ts test/fixtures/real/app.mrp
npx tsx tools/real/run-app.ts
npm test
npx tsc --noEmit
```
