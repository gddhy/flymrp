# 本地兼容组件

这些文件提供旧手机运行环境中的字库和插件。游戏本体仍由用户从本地目录加载，测试清单保存文件的 SHA-256，不复制游戏到仓库。

- `system/gb16.uc2`：项目原有的 16 点 UCS-2 字库，SHA-256 `6a6d819025765b4b967aa9dd5c7efc5c86b06265b73a14db91869b22bf3d2dd5`。
- `system/gb12.uc2`、`gb12_uc2.adl`、`gb16_uc2.adl`：来自用户游戏集合中的 `320×480分辨率游戏（无中文明命名）/相关文件/system/`。12 点字库 SHA-256 为 `f8e9a443e28eecce3a99f0ebf26a197b1ef5e65bab5406054ff7e985d48274b3`，两个索引文件均为 `3149a176488216bda8e4656c918962584c19d29fdde1a9e40c162e0da3a33bce`。
- `plugins/netpay.mrp`：来自本机参考项目 `rxgj-main/test/fixtures/plugins/netpay.mrp` 的兼容测试组件，appid 480010、版本 386，SHA-256 `6f6d7f07d9751860bd77f76e4b844bf60332e6a36af1966ccb86eecdff3cfd4c`。参考项目的 `omx_wiki/gjxwsmn-netpay-plugin-update-progress.md` 记录了该文件的来源与版本。此前测试用户集合的版本 374 时，《干柴烈火美女剑》会报付费值异常；版本 386 能完成本地提示回调并恢复剧情。

每次运行将组件复制到独立的内存文件系统。来宾无法访问真实短信、支付或网络；传输接口返回失败。组件存在不意味着依赖在线服务器的游戏已经兼容。
