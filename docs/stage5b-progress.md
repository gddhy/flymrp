# Stage 5-B：Mythroad Core Runtime

状态：实现完成。  
范围：A + 必要 B 类 Mythroad API；VFS；DeviceProfile；确定性 timer / event；Null graphics；synthetic input；`runtime.step()`。  
未接入：Canvas / WebGL / WebAudio / DOM scheduler / IndexedDB / 网络 / JIT / 完整 API。  
Stage 3/4 CPU 与 EXT ABI **未改**。

**real start.mr binary unavailable**（rxgj 仓库无 `*.mr` / `*.mrp`）。`unused/start.mr.lua` 只作 ABI/控制流证据，不当成 binary。

---

## Inventory

见 `docs/stage5b-api-inventory.md`。

| 类 | 已实现 | 说明 |
|---|---|---|
| A | 29 | start.mr 生命周期 / `_strCom` 601/800–802 / `_com` 已确认码 / GetSysInfo / timer / 最小 draw / Exit / `_t` `_gc` |
| B | 26 | VFS file.*、sys.*、GetDatetime、`_rand/_mod` 位运算、`_strCom(602)`、line/point/dispUpEx |
| C | stub | NullGraphicsBackend 记录 DrawCommand |
| D/E/F | 0 | audio / network / 其余 `_strCom` / `_plat` / Bitmap / GUI |

---

## 分项 tests

| 项 | 文件 | n |
|---|---|---|
| API inventory | `test/mythroad/inventory.test.ts` | 11 |
| VFS | `test/mythroad/vfs.test.ts` | 12 |
| SystemInfo | `test/mythroad/system.test.ts` | 6 |
| Timer | `test/mythroad/timer.test.ts` | 11 |
| Event | `test/mythroad/events.test.ts` | 11 |
| Graphics null | `test/mythroad/graphics.test.ts` | 8 |
| Input | `test/mythroad/input.test.ts` | 6 |
| start.mr fixture | `test/mythroad/start.test.ts` | 6 |
| error-path 5-B | `test/mythroad/errors.test.ts` | 9 |

`npm test`：**277/277**。`tsc --noEmit` 通过。

---

## 性能（本机，第二次 `npx tsx bench/run.ts`）

| 项 | 结果 | vs 5-A 冻结 |
|---|---|---|
| Lua opcode/sec | 48.91 Mops/s | 48.62（无回归） |
| Lua → native | 0.12 µs/call | 0.13 |
| Lua → EXT → Lua | 10.43 µs/call | 11.26 |
| start.mr full | 765 µs/call | 788 |
| ARM ADD+cache | 44.60 Mips | 45.05（噪声） |
| EXT direct | 187 kcalls/s | 178 |
| table bridge | 4.95 µs/call | 5.32 |
| runtime.step | 2.75 M steps/s | 新 |
| event dispatch | 4.23 M/s | 新 |
| timer callback | 5.11 M/s | 新 |
| vfs.readFile | 13.0 M reads/s | 新 |
| native GetSysInfo | 4.16 µs/call | 新 |

未改 `src/hot` / `src/abi`。首次 bench ARM 偏低属同机波动，复跑回到冻结量级。

---

## 已知兼容性

* `file.open` 返回带方法的 **table**，不是 C `FILE*` userdata（无 TM_INDEX）。
* `_com(400)` 不阻塞，只记录 `sleeps[]`。
* 平台 timer 是 **one-shot**；repeat 靠 callback 再 `TimerStart`。
* `_not` 是逻辑非（源码 `!n`）。
* `f:seek` 成功时 push **传入 offset**（与 `mr_iolib_target.c` 一致）。
* 无真实 `start.mr` binary。

---

## 如何跑

```bash
npm test
npx tsc --noEmit
npx tsx bench/run.ts
```

Stage 5-B 停止。不要进入 Stage 5-C。
