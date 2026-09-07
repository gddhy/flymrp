# 白跑分 v1.1.5 回归

样本：`bpaofen/baipaofenv1.1.5.mrp`，SHA-256：`341999f1f51f12266e24181323fdc5871ebe5133d555e38cac8fcf3ab69f3fad`。与精选 100 和原始 13 个失败游戏的清单分开维护。

修复内容：

- 内存测试在 `getTime` 之间调用 malloc/free，旧实现因 ABI 调用被打断而不推进时间，最终在 `0x1e82e00` 触发 128M 指令 watchdog。持续轮询现在计入其他 ABI 调用之间的指令；普通绘制前后的少量时间采样保持原行为。没有提高 watchdog，也没有修改样本或分数。
- `sprintf` / `printf` 支持 AAPCS 对齐的 64 位 `%lld/%llu/%llx/%llX`，综合分可以正常输出；包括负数、超过 JavaScript 安全整数范围及寄存器到栈的参数边界测试。
- 信息页查询的 `mr_plat(1327)`（Wi-Fi）和 `1391`（后台服务）返回明确的不支持状态，依据本地 rxgj `mythroad/dsm.c`。
- 网页在独立 Worker 中执行游戏，刷屏消息限频，结束或切换游戏直接终止旧 Worker；计算期间工具栏保持响应。

验证：信息页 → 返回 → 完整五项跑分 → 信息页 → 返回 → 第二次完整跑分 → 持续运行 60 秒。逐帧人工检查信息页和综合分结果后，将哈希写入 `config/benchmark-scenarios.json`，重复运行通过。原始记录在本地 `artifacts/baipaofen-verified/results.json`。另外在静态网页 `/dist/main.html` 手动验证信息页、五项结果以及计算期间打开/关闭设置，浏览器未报告 error/warn。

复现命令：

```sh
MRP_TEST_MANIFEST=config/benchmark-games.json \
MRP_TEST_SCENARIOS=config/benchmark-scenarios.json \
MRP_TEST_PRODUCTION=1 npm run test:collection -- \
'/Users/zixing/Downloads/macos-arm64 (4)/mythroad' artifacts/baipaofen-current
```

跑分基于模拟时钟：持续同步轮询按 16.384 MIPS 推进，普通事件与显示测试受宿主节拍影响。结果用于验证模拟器兼容性，不能作为电脑、浏览器或真机性能排名。当前原始 13 个游戏和精选 100 的完整可玩性验收仍单独进行，白跑分通过不代表它们已经全部通过。

## 2026-09-07 实际计时与热点优化

网页 Worker 的同步计时使用 `performance.now()`，不再把固定的 16.384 MIPS
指令换算速度当成设备跑分。普通事件仍由播放器驱动，确定性回归不注入实时时钟，
原跑分结果与信息页面的画面哈希保持一致（`artifacts/baipaofen-perf-final`）。
同步负载能在时间持续前进时续用指令额度，但保留 30 秒截止时间；显式指令限制不会续期。

热点基本块在 32 次访问后用数值 IR 生成专用 JavaScript；不支持的指令仍调用解释器，
CSP 禁止动态编译时自动回退。每条指令保留条件、标志、预算、异常 PC 和自修改代码检查。
内存写入通过代码页索引定位缓存，分配记录通过活动地址索引查找，减少排序和内存循环开销。

本机 Node 同一实际计时模式 A/B：排序 4,984 → 10,796，内存 263 → 452。
原始结果见 `baipaofen-perf-2026-09-07.json`。这是一次对照样本，分数受主机负载影响。
可用 `npx tsx tools/real/benchmark-perf.ts /absolute/baipaofenv1.1.5.mrp output.json`
交替复测解释器与编译执行。此脚本不修改 MRP 或分数公式。

构建后的网页实测完整跑分：排序 12,725、内存 542，结果页打开信息正常。
自动测试覆盖整数边界、条件码、进位/溢出、非对齐访问、预算中断、自修改代码和计时边界。

### 后续内存优化与真实时间对照

加入 LSR/ASR/ROR 常量移位、条件分支与寄存器地址读写的专门编译；小型回跳循环直接留在已编译函数内，仍保留每条指令的预算、失效检查及每次回跳的宿主截获。修正 BLX LR 在改写链接寄存器前读取跳转目标。

停止其他运行中的网页游戏后，同机 Node 实时时钟两轮 A/B 记录在 `baipaofen-memory-2026-09-07.json`：解释路径内存 260 / 252、排序 4716 / 4786；编译路径内存 897 / 890、排序 14906 / 14773。相对上一轮仅 ALU/立即地址编译的约 450 内存分数，再提升约一倍。当前没有达到 2000–3000 分，不更改 MRP、计分公式或时钟倍率。

对照脚本同时修正了结果标签采集：原程序显示“累加”，此前脚本误写“累计”，会在五项已经显示后错误报告未完成。统计现在严格要求五项结果齐全。
