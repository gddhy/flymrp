# Real Binary Readiness (Stage 5-C.1)

本阶段是 **compatibility gate**，不是 Stage 5-D，也不实现 UNKNOWN ABI。

**Stage 5-D：NOT STARTED。**

工作区有用户提供的真实 `test/fixtures/real/app.mrp`（蜀山剑侠传 / `gssjxz.mrp`）。Inspection **CONFIRMED**，startup **未通过**，**real-app green = false**。

Stage 5-C.5：`table[14]` memset 已接。cfunction load 完成，`arm_ext_call(6)` guest 返回 0。完整 runtime 第一个失败是 `UNKNOWN_REQUIRED_SLOT = 130`（`asm_mr_TestCom`，未实现）。见 `docs/stage5c5-progress.md`。

---

## 工具

```bash
npx tsx tools/real/inspect.ts
npx tsx tools/real/inspect.ts path/to/app.mrp
npx tsx tools/real/run-app.ts
```

无参数：打印 fixture 是否存在 + loader readiness。有文件也不声称 real-app green。

代码入口：

| 路径 | 作用 |
|---|---|
| `src/real/inspect.ts` | 只读 format 分类 |
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
