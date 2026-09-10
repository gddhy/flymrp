# MRP 全量回归记录（2026-09-08）

本次对 `/Users/zixing/Downloads/mrp游戏大集结` 递归发现的 **11,792** 个 `.mrp` 逐个启动。扫描器为每个文件创建独立 Node worker，单包 30 秒 watchdog，避免单个死循环阻塞全量结果。

## 第一阶段：全量粗筛

命令：

```sh
MRP_COARSE_CONCURRENCY=12 npm run test:coarse -- \
  "/Users/zixing/Downloads/mrp游戏大集结" \
  artifacts/coarse-all-20260908-final
```

结果（`artifacts/coarse-all-20260908-final/results.json`）：

| 分类 | 数量 |
| --- | ---: |
| 输入后画面变化 | 1,129 |
| 静态非黑屏 | 2,152 |
| 正常退出 | 470 |
| 黑屏 | 62 |
| 启动/运行错误 | 7,978 |
| 单包 watchdog 超时 | 1 |

粗筛覆盖率为 11,792 / 11,792。启动/运行错误中主要是合集里的资源片段、需要同目录 `start.mr` 或 SDK key 的模块、损坏 MRP 文件，以及在 1M 指令快速预算下无法完成初始化的包；这些不能作为独立应用直接启动。

## 第二阶段：重点包详细回归

从粗筛结果中选出 216 个含 ABI 异常、黑屏或超时信号的包，使用生产指令预算执行 30 tick 启动流程并发送 FIRE 输入。结果（`artifacts/detail-abi-20260908-v4/results.json`）：

| 分类 | 数量 |
| --- | ---: |
| 无输入响应 | 62 |
| 需要场景检查 | 124 |
| 正常退出 | 7 |
| 黑屏 | 3 |
| 运行错误 | 19 |
| 单包 watchdog 超时 | 1 |

本轮已覆盖并验证粗筛发现的 `mr_plat/mr_platEx` 私有探针、可选 handset `table[128]`、`_com(302)`、`_strCom(600)` 及 `%p` 指针格式，不再出现对应的 ABI 未实现错误。剩余运行错误为损坏/未终止格式串（8 个）或包内 Lua 调用了非函数（11 个）；这类包本身缺少可独立运行的有效入口，不能通过模拟器补齐。

## 可重复执行

```sh
npm run typecheck
npm test
MRP_COARSE_CONCURRENCY=12 npm run test:coarse -- \
  "/Users/zixing/Downloads/mrp游戏大集结" artifacts/coarse-all
```

