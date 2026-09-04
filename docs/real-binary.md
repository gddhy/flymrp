# Real Binary Readiness (Stage 5-C.1)

本阶段是 **compatibility gate**，不是 Stage 5-D，也不实现 UNKNOWN ABI。

**Stage 5-D：NOT STARTED。**

工作区有用户提供的真实 `test/fixtures/real/app.mrp`（蜀山剑侠传 / `gssjxz.mrp`）。Inspection **CONFIRMED**，startup **未通过**，**real-app green = false**。

Stage 5-C.10M：实现 `table[3]` memcpy2 + `table[10]` strcmp2。未实现 `table[1]`。生产停在 table[1]。见 `docs/stage5c10m-progress.md`。  
Stage 5-C.10L：`table[3]` memcpy2 ABI + directory loop 只读取证，当时未实现。当时生产停在 table[3]。见 `docs/stage5c10l-progress.md`。  
Stage 5-C.10K：实现 current-pack 只读 file backend（table[40]/[44]/[45]/[41]）。当时生产停在 table[3] memcpy。见 `docs/stage5c10k-progress.md`。  
Stage 5-C.10J：current-pack file ABI 只读取证。当时未实现 table[40]/41+。见 `docs/stage5c10j-progress.md`。  
Stage 5-C.10I：实现 `table[100]` / `pack_filename` 128-byte data slot。生产仍停在 table[40]；LIVE filename 为 `"gssjxz.mrp"`。见 `docs/stage5c10i-progress.md`。  
Stage 5-C.10H：`table[40]` / `mr_open` 只读取证，未实现。当时空 filename 来自 `table[100]`。见 `docs/stage5c10h-progress.md`。  
Stage 5-C.10G：`table[17]` / `sprintf_` 仅 literal + `%d`。当时生产停在 table[40] `asm_mr_open`。见 `docs/stage5c10g-progress.md`。  
Stage 5-C.10F：`table[17]` / `sprintf_` 只读取证，未实现。当时生产停在 table[17]。见 `docs/stage5c10f-progress.md`。  
Stage 5-C.10E：`table[33]` `mr_getTime` 接 deterministic `runtime.clock >>> 0`。当时停在 table[17]。见 `docs/stage5c10e-progress.md`。  
Stage 5-C.10D：`table[33]` / `asm_mr_getTime` 只读取证，未实现。当时生产停在 table[33]。见 `docs/stage5c10d-progress.md`。  
Stage 5-C.10C：`table[38]` 仅 `mr_platEx` code `0x4c6`（rxgj FULL `MR_SUCCESS`，无副作用）。生产确定性停在 table[33]。未实现 33。见 `docs/stage5c10c-progress.md`。  
Stage 5-C.10B：`table[130]` 仅 case 7（rxgj FULL）。当时停在 table[38]。见 `docs/stage5c10b-progress.md`。  
Stage 5-C.10A：真实 MRP 启动基线（实现 130 前）。见 `docs/stage5c10a-progress.md`。  
Stage 5-C.9：`table[38]` 本次是 6 参数 `mr_platEx(0x4c6,0,0,0,0,0)`，返回值不挡后续 CFG。见 `docs/stage5c9-progress.md`。未实现 130/38/33。  
Stage 5-C.8：`0x01ea7f68` 在越过 130 后打 `table[38]` `asm_mr_platEx(0x4c6,0,0,0,0,0)`。见 `docs/stage5c8-progress.md`。未实现 130/38。  
Stage 5-C.7：`table[130]` 返回值不是这段 `mrc_init` helper 直达 CFG 的必要条件。见 `docs/stage5c7-progress.md`。未实现 TestCom。  
Stage 5-C.6：`table[130]` / `asm_mr_TestCom` 只读取证。真实调用点与 R1/R2 生产指令见 `docs/stage5c6-progress.md`。  
Stage 5-C.5：`table[14]` memset 已接。cfunction load 完成，`arm_ext_call(6)` guest 返回 0。完整 runtime 第一个失败仍是 `UNKNOWN_REQUIRED_SLOT = 130`。

---

## 工具

```bash
npx tsx tools/real/inspect.ts
npx tsx tools/real/inspect.ts path/to/app.mrp
npx tsx tools/real/run-app.ts
npx tsx tools/real/startup-baseline.ts test/fixtures/real/app.mrp
npx tsx tools/real/forensics-40.ts test/fixtures/real/app.mrp
npx tsx tools/real/forensics-file-chain.ts test/fixtures/real/app.mrp
npx tsx tools/real/forensics-3.ts test/fixtures/real/app.mrp
```

无参数：打印 fixture 是否存在 + loader readiness。有文件也不声称 real-app green。

代码入口：

| 路径 | 作用 |
|---|---|
| `src/real/startup.ts` | 5-C.10M 真实 MRP 生产启动基线（table[3]/[10] REAL_EXECUTED；停在 table[1]） |
| `src/real/memcpy3.ts` | 5-C.10L table[3] memcpy2 / directory loop 只读取证（当时不实现 3/10/1） |
| `src/real/open40.ts` | 5-C.10H table[40] / `mr_open` 只读取证 |
| `src/real/filechain.ts` | 5-C.10J file ABI 静态链 / 只读 handle 设计（不实现） |
| `src/real/gate.ts` | parse → load → 有限 step → report |
| `src/real/readiness.ts` | READY / PARTIAL / BLOCKED 审计 |
| `src/mythroad/probe.ts` | 可选 trace（默认关） |
| `docs/real-binary-compatibility-report.md` | 报告模板 |

分类只使用已确认 magic：

| magic | 结果 |
|---|---|
| `MRPG` / `MRPF` | CONFIRMED MRP |
| `\033MRP` | CONFIRMED Lua chunk |
| `1F 8B 08` | CONFIRMED gzip |
| `MRPGCMAP` | CONFIRMED EXT |
| `\x7fELF` 32-bit LE | CONFIRMED EXT ELF |
| `PK\x03\x04` / EOCD | CONFIRMED ZIP/JAR 容器（不是 MRP） |
| ZIP 加密标志 | UNSUPPORTED（不解密） |
| 其它 | **UNKNOWN**（不当成 raw EXT） |
| 已知 magic 但截断/损坏 | INVALID |

---

## Runtime trace

`new MythroadRuntime({ trace: true })` 或传入 `RuntimeTrace`。

默认关闭：不包装 native / VFS / timer / gfx，不改 ABI。

未知 API：写入 `unknownEvents`，**不自动实现**。

| abiMode | 行为 |
|---|---|
| `strict`（默认） | 记录（若有 trace）+ 抛 `UnknownAbiError` |
| `trace` | 同 strict（必须记录 + 安全停止） |
| `permissive` | 仅当 `approvedUnknown` 显式给出 `return0`/`returnNil` 才继续；否则仍停止 |

---

## Readiness

没有任何一项是 **READY**。真实 `app.mrp` 在盘上 = PARTIAL，不是 READY。`魔塔II.jar` 仍 BLOCKED。
