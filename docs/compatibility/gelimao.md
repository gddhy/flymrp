# 给力猫兼容回归

文件：`240×320游戏大全/大屏棋牌休闲/免费-仿安卓版给力猫_大屏棋牌休闲.mrp`

该游戏启动时通过扩展接口查询背光状态 `mr_plat(1020)`，随后使用 `mr_platEx(3001)` 获取 JPEG 尺寸、`mr_platEx(3002)` 解码 JPEG 到 RGB565 缓冲区，并探测录音接口 `mr_platEx(2700)`。运行时现在提供虚拟背光状态、PNG/GIF/BMP/JPEG 尺寸解析、JPEG/RGB565 解码回退，以及录音不可用时的 `MR_IGNORE` 返回。

回归命令：

```sh
MRP_TEST_MANIFEST=/tmp/flymrp-gelimao-manifest.json \
MRP_TEST_SCENARIOS=config/app-scenarios.json \
MRP_TEST_PRODUCTION=1 npm run test:collection -- \
  "/Users/zixing/Downloads/mrp游戏大集结" artifacts/gelimao-final
```

结果：启动不再出现 `unsupported mr_plat code 1020`，也不会因 3001、3002 或 2700 中止；当前自动场景判定为 `no-input-response`，因为该版本启动后是静态图片界面，尚未定义可验证的游戏操作场景。
