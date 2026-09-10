# 虚拟 SD 卡

在模拟器设置中展开“虚拟 SD 卡”，填写目标目录并选择一个或多个文件。留空表示手机 `mythroad` 根目录；例如 `My Music` 对应 `c:/mythroad/My Music/`。原版 IPOD 音乐播放器默认扫描 `My Music`，上传后可重启应用重新扫描。MP3/WAV 等文件还可以在文件列表中试听。

上传文件保存在当前网站、当前浏览器的 IndexedDB 中，刷新和重新打开游戏后仍可用，不发送到服务器，也不增加静态部署包大小。清理网站数据会清除上传文件；同名文件覆盖，列表可删除。当前持久保存范围是用户上传的文件，游戏在运行期间新建或修改的文件仍是会话内数据。

ARM `mr_open`、目录枚举和 Lua 文件读取均可读取这些文件。EFS 统一处理大小写、GBK 中文文件名和 `c:/mythroad/` 路径；MRP 内部资源名仍保留原来的大小写规则。

音频兼容性依据 SDK 的 [mrc_sound.h](https://github.com/vmrp/MythroadSDK/blob/master/modules/mrc_sound.h) 和存档的 SKYENGINE 手册：[设备状态](https://gddhy.net/2022/skyengine-api/mr_platEx%28209x%29.htm)、[总时长](https://gddhy.net/2022/skyengine-api/mr_platEx%28212x%29.htm)、[秒进度](https://gddhy.net/2022/skyengine-api/mr_platEx%28213x%29.htm)、[毫秒进度](https://gddhy.net/2022/skyengine-api/mr_platEx%28215x%29.htm)。修复了设备 0 查询报错、状态缺少 1000 基值、时长查询未实现和恢复播放从头开始的问题。

2026-09-07 验证：浏览器上传自生成的两秒 MP3，跨页面读取保留；原版 `开发IPOD音乐播放器_播放阅读.mrp` 扫描、加载并进入播放状态；Node 回调收到 8,808 字节 MP3。单元测试覆盖中文路径、ARM/Lua 读取、重载、删除、MP3 时长与暂停恢复位置。MP3 时长按 MPEG 音频帧计算，编码器填充可能带来少量尾部差异；暂不支持的媒体格式时长返回 0。
