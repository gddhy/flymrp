# 51 桌面兼容性记录

原文件：`opdesk（51桌面）.mrp`（SHA-256 `07e4e9de0e0ee1dbf00efc3f2b31d19d8a4b407e455be6ffcb0abefc495a9532`）。

该程序启动时会调用 `mr_plat(1016)` 初始化信号服务，并在退出时调用 `mr_plat(1018)`。运行时现在返回真实 SDK 约定的 `MR_SUCCESS`，并实现 `mr_platEx(1017)` 的虚拟四字节信号结构，因此不会再因 `unsupported mr_plat code 1016` 黑屏中止。对应测试见 `test/mythroad/signal.test.ts`。

网页实测可以启动并显示程序画面。程序随后会请求 `spd.skymobiapp.com/simpleDownload` 获取应用超市数据；离线拦截器没有该应用包时，程序显示自身的“连接服务器失败”或升级提示。这是网络资源缺失后的正常可见结果，不能把它标记为完整桌面功能已恢复。
