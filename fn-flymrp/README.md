# fn-flymrp · 飞牛 fnOS 版 MRP 模拟器

将 [flymrp](https://github.com/zixing131/flymrp) 浏览器版模拟器（main.html 播放器部分）移植为飞牛 fnOS 微应用。只含模拟器，不含首页商店。

## 功能

- 桌面图标直接打开模拟器（统一网关 `/app/flymrp`）
- 「打开 MRP 文件」来源二选一：**本机文件**（电脑/手机）/ **飞牛 NAS 文件**（经 `pickUserFile` 授权）
- 截图保存二选一：**本机下载** / **保存到 NAS**（记住上次目录）
- 文件关联：在飞牛文件管理中**双击 `.mrp` 文件**直接唤起模拟器运行（`flymrp.OpenFile` 入口 + `fileTypes: ["mrp"]`）
- 虚拟 SD 卡、存档等播放器原生能力保留（IndexedDB，升级不受禁缓存影响）

## 目录结构

```text
fn-flymrp/
├── app/
│   ├── server/          # 零依赖 Node 服务端（静态托管 + open-file/save-file API）
│   ├── ui/config        # 桌面入口（主入口 + .mrp 文件关联入口）
│   └── www/             # 模拟器静态文件（由 build-www.sh 生成，不入库）
├── cmd/main             # 启停脚本（app.sock + 等待就绪 + 非零失败码）
├── config/privilege     # run-as package
├── config/resource      # api-scope: trim.file.userAccess + data-share
├── src/fnos.js          # 集成层源码（宿主判定/来源二选一/截图保存/文件关联）
├── src/vendor/          # @trimjs/web-app 0.4.2 UMD 包装（离线内置）
├── build-www.sh         # 从 ../dist 生成 app/www 并打补丁
├── manifest             # micro_app + install_dep_apps=nodejs_v22 + 统一网关
└── LICENSE              # AGPL-3.0 全文（随分发提供）
```

## 构建与打包

```sh
# 1. 先在上层目录构建出 dist/（模拟器产物来源）
cd .. && bash build.sh && cd fn-flymrp

# 2. 生成 app/www（复制 + 去 PWA + 挂集成层）
bash build-www.sh

# 3. 打包 fpk（fnpack.exe 不入库）
../fnpack.exe build --directory .
# 产物：flymrp.fpk
```

## 安装后访问

- PC 桌面：应用图标 → `https://<nas>/app/flymrp/`
- 手机端：飞牛 App 内打开，支持触屏与文件授权
- 文件关联：文件管理器中双击 `.mrp` → 以 `?path=/vol1/...` 打开本应用

## 排查

- 服务端日志：`${TRIM_PKGVAR}/info.log`（socket 监听失败、保存失败等均有记录）
- 页面控制台：`flymrpFnos.diagnose()` / `flymrpFnos.report()`（含 bridge 原始报文）
- `pickUserFile` 返回 `1003103`：重装应用；或先在文件 App 收藏目标目录再试
- 改代码重装后行为没变：静态资源已 `no-store` + 指纹自刷，仍异常时清 WebView 缓存

## 开源合规

上游 flymrp 为 AGPL-3.0-only，本移植版同样以 AGPL-3.0-or-later 分发，包内附协议全文（LICENSE）。
`src/vendor/` 内为 [@trimjs/web-app](https://www.npmjs.com/package/@trimjs/web-app)（飞牛官方 JS SDK）。
