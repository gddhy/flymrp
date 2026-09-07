# 原始 13 个启动失败样本

`config/startup-regressions.json` 固定原始文件路径与 SHA-256。精选库中换用其他版本，不能视为修复这些文件。

2026-09-07 的公共修复包括：Lua RGB565 位图、精灵和图块实际绘制，GBK/UCS-2BE 文字解码，声音资源与字体查询；原生菜单/文本框、目录枚举、LCD 旋转；嵌套插件 MRP 读取；上传包的会话内写入副本；兼容 SDK 在 free 后立即清空对象字段的释放边界。

释放延迟只持续到下一次 ABI 调用或返回宿主。下一次 malloc 可以立即复用该块，堆损坏与指令预算错误仍会报告。容器写入不会修改本地上传文件或 Git 中的原始文件。短信接口是虚拟设备回调，不连接宿主短信服务。

当前观察，不能表述为“13 个全部可玩”：

- 俄罗斯方块、梦幻宝石、水晶宠物、泡泡龙、魔兽连连看：原来的启动错误消失，已看到实际棋盘/游戏场景并有按键变化，持续模拟 60 秒无运行错误。
- 冒险岛、冒险岛 2：原来的堆错误消失；自动输入分别停在注册提示、剧情提示，需要专门的游玩路径。
- 拳皇格斗天王：嵌套 `smsend.ext` 已成功加载，原先空资源导致的崩溃消失；自动输入仍停在开场画面。
- 贪吃猫：旋转 API 和切换到 480×320 后的行宽已修复，画面正常；自动输入到达游戏结束/注册提示，尚不能据此确认完整游玩。
- 推箱子：支持向当前包写入私有副本后，已显示“解压完成，正在退出”；还需要完成解压后的重新加载流程。
- 西游记释厄传：目录 API 已补齐，游戏实际报告缺少资源包，随后退出。
- 仙剑问情仍黑屏；金庸群侠合辑仍需要 `_strCom(3)` 和应用切换支持。

完整原始报告在本地 `artifacts/original-13-current/results.json`，后续横屏修复报告在 `artifacts/logical-lcd-fix/results.json`。这些是调试产物，不打包到网页，也不自动成为通过证据。

复测命令：

```sh
MRP_TEST_PRODUCTION=1 \
MRP_TEST_MANIFEST=config/startup-regressions.json \
MRP_TEST_SCENARIOS=/tmp/no-scenarios.json \
npx tsx tools/real/collection-test.ts "$MRP_GAME_DIR" artifacts/original-13-current
```

默认路径只检查启动、预设输入和持续运行。只有人工核对游戏场景与操作结果并固定对应校验值，runner 才会给出 `passed`。`needs-scene-review`、`no-input-response`、缺资源或注册页均不能计入全部通过。

## 更长时间的网页检查

俄罗斯方块在约 123 秒结算时会通过 `init0.mr` 调用 `_store.store` 保存分数。该库缺失会导致 `attempt to index a non-table`，60 秒用例无法暴露。接入已有的二进制表序列化后，`artifacts/tetris-storage/results.json` 的 2000 个尾部 tick 已覆盖结算；另外用原始文件连续模拟 804240 毫秒，未再出现该错误。Lua `_store` 的循环引用与分数读写已有独立回归测试。

## 精选 100 个文件的复测边界

`artifacts/classic-controls-native/results.json` 是一次完整的 100 文件运行，使用 `config/classic-scenarios.json` 和生产资源。结果为 77 个待核对场景、18 个预设操作未产生变化、5 个运行错误，**并非全部通过**。该配置只有从旧报告迁移的部分游戏路径，不是 100 个已审批的场景。

后续 `artifacts/classic-errors-storage` 与 `artifacts/classic-libc` 的定向检查又修复了 EFS 文件名大小写与缺失的 C 字符串接口。《三国志群英会》原有读取失败消失；《口袋灵兽》通过了资源加载但进入后续阶段后仍超时。清凉海滩连连看、植物大战僵尸和夜间版还存在扩展模块运行错误。这些定向结果不覆盖、也不修改之前的完整报告。
