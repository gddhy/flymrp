# 口袋灵兽：重复定时回调

2026-09-07，`mrpoid2在线商城所有游戏/口袋灵兽.mrp`。

同一段 9,600 ms 虚拟时间、600 次平台定时事件，修复前执行 1,200 次 EXT code=2 和 1,200 次 timerStart(10)，修复后均为 600 次。时间 ABI 本身没有多累计；重复发生在宿主直接调用 EXT 后，Lua dealtimer 再次转发到 EXT。现在由存在的 Lua 回调负责分发，没有 Lua 回调才直接调用 EXT，与按键分发一致。

修复保留游戏原始 10 ms 定时请求，未修改 MRP、运行倍速或计分。`test/mythroad/timer-dispatch.test.ts` 覆盖 Lua 转发、纯 EXT、故障透传。13 个重点游戏的复测记录在本地 `artifacts/timer-once`；原有依赖动画时序的截图基线需重新人工审核，不能按旧哈希直接认定通过。
