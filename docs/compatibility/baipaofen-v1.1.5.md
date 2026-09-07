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
