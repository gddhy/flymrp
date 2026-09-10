# Stage 5-A：MRP Loader + Mythroad Lua VM Foundation

状态：实现完成，等待确认。  
范围：`MRPArchive` + 修改版 Lua 5.0 VM（`\033MRP`）+ 最小 `_strCom` + Lua↔EXT 合成链路。  
未接入：Canvas / WebGL / WebAudio / DOM / Input / Scheduler / IndexedDB / 完整 Mythroad API / 网络 / JIT / `eval` / `new Function`。  
Stage 3/4 CPU 与 EXT ABI **未改**。

---

## 从 rxgj 源码确认的事实

| 项 | 证据 | 结论 |
|---|---|---|
| MRP 魔数 | `mrc/mrp.h`、`_mr_readFile` `1196446285`、`desktop_manager.c` | **MRPG** 主路径；**MRPF** 与 MRPG 同布局（桌面检查同样读 hdr+16） |
| 头 / 目录 | `T_MRP_HEAD` + `_mr_readFile` 新版索引 | 小端；`FileStart+8` 为数据起点；目录项 `name_len + name + off + packed_len + reserved` |
| gzip | `mr_gzip.h` `1F 8B`；`aex_pack.c` inflate | payload 以 `1F 8B 08` 识别；目录只存 packed 长度 |
| 嵌套 | 条目可以是完整 MRP | `openNested(name)` 再 parse；不自动摊平 |
| Lua magic | `mr_undump.h` | `"\033MRP"`，**不是** `\033Lua` |
| 版本 | `mr_dump.c` 写 `0x80`；`LoadHeader` 接受 `0x50..0x80` | `>0x50` 短头（无 size/TEST_NUMBER）；`0x50` 长头 |
| `mrp_Number` | `mr_user_number.h` `USE_INT` | **`int`（32-bit）**，不是 double |
| TEST_NUMBER | `(int)3.14159265358979323846E7` | `31415926` |
| opcode | `mr_opcodes.h` `NUM_OPCODES = OP_BXOR+1` | **39**：Lua 5.0 + BNOT/BAND/BOR/BXOR |
| 编码 | 同 Lua 5.0 | OP 6 / A 8 / B 9 / C 9；RK：`< MAXSTACK(250)` 为寄存器 |
| 无 OP_FORPREP / OP_VARARG | 枚举与 VM | 数值 for：`SUB` 后 `JMP` 到 `FORLOOP`；vararg 走 `arg` 表 |
| POW | `mr_vm.c` Arith TM_POW | 查 globals `__pow`；不是函数则 `err:1020`。`mythroad.c` **未** `mrp_open_math` |
| 位运算 | `mr_vm.c` | 非 number **静默不写**；`(long)` 后存回 int |
| `_strCom` | `TestCom1` / `_mr_TestCom1` | `_strCom(code, str [, extra])` |
| 601 | 同文件 | `_mr_readFile` → string 或 nil，return 1 |
| 800/802 | 同文件 | `arm_ext_load(str, len, optint(3))` → 推 r0/status，return 1 |
| 801 | 同文件 | `arm_ext_call(tonumber(3), str, len)` → output + ret，return 2 |

---

## 架构边界

```
MRP Loader → start.mr → Lua VM → native ABI → Mythroad → mr_table → EXT → ARM/Thumb CPU
```

Lua **不**直接调 EXT。`src/hot` / `src/abi` 不依赖 `src/lua`。

TValue（正确性优先）：`tags: Uint8Array` + `nums: Int32Array`；string intern / table / closure 分表。未使用 `class TValue { value: any }`。

Hot 执行：`Uint32Array` 指令，禁止 `Instruction[]`。

gzip：仓库内纯 JS inflate（stored + fixed + dynamic），无 Node zlib。

---

## 分项结果

| 项 | 内容 | tests |
|---|---|---|
| 5-A-1/2 MRP | MRPG/MRPF、索引、gzip、嵌套、错误路径 | 14 |
| 5-A-4/8 chunk | `\033MRP` 0x80 / 0x50、算术/分支/调用/闭包/upvalue/表/串/循环/位运算/vararg/return/嵌套 proto | 13 |
| 5-A-7 opcode | 39 opcode 均有 semantic / edge / stack 或 error | 57 |
| 5-A-9 native ABI | push int/number/string/bool/nil、get arg、多返回、缺参 | 8 |
| 5-A-11 Lua↔EXT | 601 读包、800 加载、801 往返、table bridge、确定性 start.mr | 5 |
| 5-A-12 errors | MRP / chunk / runtime / native / EXT-CPU，不吞异常 | 9 |

`npm test`：**197/197**（Stage 3/4 原 91 + 本阶段 106）。

---

## 性能基线（本机 Node，`npx tsx bench/run.ts`）

Stage 5-A 不追求极限；未改 CPU。数字随机器波动。

| 项 | 结果 | 分配（`LuaState.stats`） |
|---|---|---|
| Lua arithmetic/loop（100k FORLOOP） | 9.64 Mops/s（迭代） | intern=2 tbl=1 cl=4 |
| Lua function call（50k 热循环） | 6.46 Mops/s | intern=2 tbl=1 cl=6 |
| Lua table access（50k SET+GET） | 2.08 Mops/s | intern=2 tbl=3 cl=4 |
| Lua opcode/sec（arith proto 200008 insns） | **48.62 Mops/s** | （同上 arith） |
| MRP `readFile` | 13.0 M reads/s | 无 Lua 分配 |
| Lua → native | **0.13 µs/call** | intern=3 tbl=1 cl=5 |
| Lua → EXT → Lua（`_strCom(801)`，EXT 已加载） | **11.26 µs/call** | — |
| 完整 `start.mr`（601+800+801） | 787.58 µs/call | 含新建 `ExtRuntime` + load |

Stage 3/4 同机对照（未改源码）：ARM ADD+cache 45.05 Mips；EXT direct 178 kcalls/s；table 5.32 µs/call。

无独立 Lua GC：只有 `stats.{interns,tables,closures,upvals}` 计数；回收由宿主 JS GC 负责。

---

## 未实现 / 未确认

| 项 | 说明 |
|---|---|
| `__pow` 默认安装 | 源码只在 **unused** `mr_mathlib.c`；主路径未 `mrp_open_math`。VM 按源码要求 globals.`__pow`，opcode 测试自行注册 |
| 完整 tag method | INDEX/NEWINDEX/CALL 等未做；缺元方法即类型错 |
| `_strCom` 其它 code | 仅 601/800/801/802。2/3/300/500… 未做 |
| 旧版顺序 MRP（`FileStart<=232`） | 解析器有 sequential fallback；主测试走新版索引 |
| aex_pack 非 MRPG 子资源摊平 | 另一种无魔数顺序包，本阶段不展开 |
| 真实商业 MRP 作为唯一测试 | 禁止；仅 synthetic |
| Canvas / API / JIT | Stage 5-A 禁止项 |

---

## Stage 3/4 回归

未修改 `src/hot/**`、`src/abi/**`（除被 Lua 调用的既有 `ExtRuntime` API）。  
CPU / EXT / Unicorn 差分测试全部通过。

---

## 如何跑

```bash
npm test
npx tsx bench/run.ts
```

Stage 5-A 停止。不要进入 Stage 5-B。
