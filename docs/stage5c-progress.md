# Stage 5-C：Real Mythroad Compatibility Layer

状态：实现完成。**不要进入 Stage 5-D。**

范围：以 rxgj FULL Mythroad（`MR_VERSION=1968`）为证据，补齐真实应用运行所需的 P0 兼容层：

```text
Lua → Mythroad API → resource/file → timer/event → EXT
```

未接入：Canvas / WebGL / WebGPU / WebAudio / DOM / `setTimeout` / IndexedDB / 网络 / SMS / WAP / JIT / DRM。  
Stage 3/4 CPU 与 EXT ABI **未改**（`src/hot` / `src/abi` 无 diff）。

**No real binary fixture available.** rxgj 与本仓库均无 `start.mr` / `*.mrp` / `魔塔II.jar`。禁止伪造 real app test。

证据：`docs/stage5c-api-evidence.md`。真实 binary 说明：`test/fixtures/real/README.md`。

---

## Inventory

| 类 | 数量 | 说明 |
|---|---|---|
| A | 29 | 冻结（5-B） |
| B | 26 | 冻结（5-B） |
| C | 21 | string/table/base 子集、SaveTable/LoadTable、`_runFile`、`_strCom` 300/500/501/502、Bitmap/Sprite/Tile 记录、`__index`/`__newindex` |

`IMPLEMENTED_A.length === 29`、`IMPLEMENTED_B.length === 26` 保持不变。

---

## 分项 tests

| 项 | 文件 | n | 门槛 |
|---|---|---|---|
| API evidence | `test/mythroad/evidence.test.ts` + 文档 | 1（文档 CONFIRMED ≥ 20） | ≥ 20 |
| string | `test/lua/string.test.ts` | 17 | ≥ 15 |
| table/metamethod | `test/lua/metamethod.test.ts` | 20 | ≥ 20 |
| integer | `test/lua/integer.test.ts` | 11 | ≥ 10 |
| closure/upvalue | `test/lua/closure.test.ts` | 10 | ≥ 10 |
| SaveTable/LoadTable | `test/mythroad/persist.test.ts` | 9 | ≥ 8 |
| `_strCom`/`_com` | `strcom-c` 9 + 5-B 既有 | ≥ 15 | ≥ 15 |
| graphics command | `graphics.test.ts` 8 + `graphics-c` 8 | 16 | ≥ 15 |
| timer/event | timer 11 + events 11 + timer-c 6 | 28 | ≥ 15 |
| restart/runFile | `test/mythroad/restart.test.ts` | 5 | ≥ 5 |
| real binary | `test/mythroad/real-binary.test.ts` | 1（unavailable） | 有则 ≥ 1 |
| error paths | `test/mythroad/errors.test.ts` | 20 | ≥ 10 |

`npm test`：**376/376**。`tsc --noEmit` 通过。

---

## 性能（本机，第二次 `npx tsx bench/run.ts`）

| 项 | 5-C | vs 5-B | vs 5-A |
|---|---|---|---|
| Lua opcode/sec | 46.95 Mops/s | 48.91（噪声 / 同机波动） | 48.62 |
| Lua → native | 0.12 µs/call | 0.12 | 0.13 |
| Lua → EXT → Lua | 11.06 µs/call | 10.43 | 11.26 |
| start.mr full | 717 µs/call | 765 | 788 |
| ARM ADD+cache | 44.18 Mips | 44.60 | 45.05 |
| EXT direct | 185 kcalls/s | 187 | 178 |
| table bridge | 4.90 µs/call | 4.95 | 5.32 |
| lua_string_len | 0.18 µs/call | 新 | — |
| lua_meta_index | 0.28 µs/get | 新 | — |
| gfx_command | 14.9 M trip/s | 新 | — |

未改 `src/hot` / `src/abi`。opcode/sec 与 ARM/EXT 波动幅度与 5-B 记录的同机噪声同级，**不作为 CPU/EXT 回归**。

stdlib 安装使 `LuaVM` 的 intern/closure 基数上升（bench `intern=57 cl=44`，5-A 为 `intern=2 cl=4`）。算术热路径仍是 `i32`，GETTABLE hit / 两 number 算术仍 inline。

---

## 关键实现选择（仅 CONFIRMED）

* **`__pow`**：`mr_T_init` 的 `tmname[TM_POW] = "__op"`；unused mathlib 才装 globals.`__pow`。主路径不 `mrp_open_math`。POW 查 `__op` 或 `__pow`，皆非函数 → `err:1020`。不改 POW opcode，不默认装 mathlib。
* **Metamethod**：GETTABLE miss / 非表 → `__index`；SETTABLE raw nil 且有 TM → `__newindex`；CALL → `__call`；算术 tonumber 失败走 TM。循环上限 100 → `table err:2014/2015`。
* **Integer**：热路径 `i32`。除零 / `INT_MIN/-1` / 负除法向零 = **implementation-defined compatibility choice**。
* **string.pack**：rxgj `b_pack`（`x bB hH lL iI c s`，`>`/`<`，默认 LE），不是 Lua 5.3 pack。
* **string.subV**：宿主无稳定 C 指针，返回 `0, len`（limitation）。
* **SaveTable/LoadTable**：Pluto LE；nil/bool/number/string/table（含环、metatable）。拒绝 function。禁止 JSON。
* **RunFile**：pending + timer `"restart"` 100ms + `state=RESTART`。禁止递归 `runFile()`。`callGlobal` 嵌套时不重置 CI。
* **Graphics**：仍 `NullGraphicsBackend`，补 image/sprite/tile command recording。

---

## 已知兼容性 / 未实现

* 无默认 `__pow`/`math`；应用必须自己注册，否则 `^` → `err:1020`。
* `string.subV` 第一返回值恒为 0。
* `string.findEx` / `gsub` / `format` / `c2u` / `u2c` / `new`/`set`/`update` 未实现。
* coroutine / thread / yield 未实现。
* Pluto 不持久化 Lua function。
* `_plat` / `_platEx` 各 code、指针类 `_strCom`/`_com`、socket/SMS/WAP、GUI、audio：未实现。
* `BitmapShowEx` 像素指针：不实现。
* 无真实 MRP/MR/魔塔II fixture。
* pack 切换无真实 FS，只跑当前 VFS 中的 startfile。

---

## 如何跑

```bash
npm test
npx tsc --noEmit
npx tsx bench/run.ts
```

Stage 5-C 停止。不要进入 Stage 5-D。
