# 本地下载与网络拦截

运行时在内存中拦截来宾的 DNS、TCP 连接和 HTTP 请求。它不修改宿主机 hosts，也不连接公网。默认地址包括 `wap.skmeg.com`、`rop.skymobiapp.com`、`spd.skymobiapp.com`、`freeads.51mrp.com`、`proxy.51mrp.com`、`proxy2.51mrp.com`、`help.proxy.51mrp.com` 和 `211.155.236.18`；同时识别旧 CMWAP 网关 `10.0.0.172`。

默认配置在 [`assets/network-rules.json`](../assets/network-rules.json)，修改后重新构建生效。前端不显示拦截规则和日志；诊断结果由批测报告中的 `interceptions` 记录，不记录请求正文或 URL 查询值。

## 两类本地响应

1. `spd.skymobiapp.com/simpleDownload`：解析请求 TLV 中的 appid `0x29ce` 和 product ID `0x2775`，从 `packages` 查找实际文件，返回包含长度、MD5、请求编号和原始包内容的完整 TLV 响应。格式依据本地参考项目 `rxgj-main/skyengine-v2-main/test/e2e/gghjt/download-plugin.test.ts` 的验证服务器。初始目录包含随项目资源快照提供的 29 个不同 appid。
2. 精确 URL 映射：`routes` 按域名或连接 IP、可选端口、方法和完整路径匹配，返回 `file` 指向的原始二进制。普通 GET 也会尝试读取同名已加载资源，如 `/mythroad_res/gsscsc/1001/scene.bin` 对应 `gsscsc/1001/scene.bin`。

示例规则（加入配置的 `routes` 数组）：

```json
[
  { "host": "proxy.51mrp.com", "path": "/game/scene.res", "file": "game/scene.res" },
  { "ip": "211.155.236.18", "port": 6009, "method": "GET", "path": "/data.bin", "file": "game/data.bin" }
]
```

`file` 是已加载的 mythroad 相对路径，不是宿主机绝对路径。`host` 与 `ip` 同时填写时，两者都必须匹配。域名精确匹配，忽略大小写和末尾的点；不隐式匹配子域名。默认连接端口为 80 和 6009，规则可以指定其他端口。当前协议范围为明文 HTTP GET/POST，不包含 TLS、UDP、在线游戏服务器或任意协议透传。

缺少数据包时返回 HTTP 404；没有命中的其他请求返回失败。日志中的 `local-package`、`local-file`、`local-resource` 表示实际读取到了文件，`missing-package`、`missing-file`、`unmatched` 则不能算下载成功。旧 ROP 测试服务单独记录为 `legacy-service`。

## 资源目录与生产构建

`mythroad/` 快照的 142 个文件已放在 `assets/`，随普通生产构建发布。开发环境可用 `MRP_SYSTEM_DIR` 覆盖同名文件。

`MRP_RESOURCE_DIR` 指向用户提供的 `mythroad_res/`；启用 `MRP_GAME_DIR` 时默认取其下的 `mythroad_res/`。网页按 MRP 包头中的内部文件名选择同名资源目录，例如 `gsscsc.mrp` 加载 `gsscsc/`，避免一次加载整个资源集合。资源导入排除已知存档/注册文件（`.sav`、`.sms`、`.sid`、`fsarpg` 存档和 `HERO_BAG`），避免旧进度改变新游戏测试流程。来宾写入只发生在隔离的内存文件系统中，不回写源目录。

```bash
MRP_RESOURCE_DIR='/path/to/mythroad_res' ./build.sh
```

构建按内容 SHA-256 增量复制所有非隐藏常规文件到 `dist/mythroad_res/` ，并为排除旧存档后的资源生成按游戏分组的 `index.json`。静态站点不需要本地目录 API，网页从该索引中按需加载；部署时需包含整个 `dist/`。本机 `.env.local` 可以保存资源路径，该机器配置不进入 Git。批测使用同一资源路径并在每个结果中记录资源 SHA-256。

## 验证

- 分段请求、分段响应、准确的文件内容、请求编号和 MD5，以及域名/IP 匹配和错误路径均有自动测试。
- 《格子风暴》诊断中删除了来宾已安装的 `flaengine.mrp`，保留本地下载源。真实游戏请求 appid 490284，出现下载进度，最终显示“下载完成”并进入标题。该验证证明下载链路有效，不代表后续所有注册和关卡都通过。

游戏库随构建发布：只复制 `config/classic-games.json` 精选清单中的 100 个文件到 `dist/games/`，生产页面读取 `games/index.json` 并按需加载。重复构建保留未变化文件，并清理发布游戏目录中不在清单内的旧文件。完整 `mythroad_res` 继续保留，也供本地打开的游戏按需使用。
