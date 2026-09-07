# flymrp

Browser-native Mythroad MRP runtime.

本项目原创代码采用 **GNU Affero General Public License v3.0（AGPL-3.0-only）**，完整协议见 [LICENSE](LICENSE)。第三方依赖、字库、插件和游戏文件保留各自的权利与许可，不因本项目的协议声明而改为 AGPL；组件来源见 [assets/README.md](assets/README.md)。

当前支持浏览器本地上传、按键与触屏输入、自动/手动分辨率，以及可选的本地游戏目录搜索。已修复屏幕尺寸全局变量导致的清屏残留，并支持封装游戏使用的内存 MRP 和 EXT 加载。兼容性仍在完善，不能保证所有 MRP 正常运行。

```bash
npm install
npm start
# 同时启用本地游戏库（仅开发服务器读取此目录，不复制游戏到仓库）
MRP_GAME_DIR='/Users/zixing/Downloads/mrp游戏大集结' npm start
```

生产构建自带用户提供的 `mythroad/` 资源快照，清单见 [assets/mythroad-manifest.json](assets/mythroad-manifest.json)。

一键静态打包：

```bash
./build.sh
# 其他机器可指定资源目录
MRP_RESOURCE_DIR='/path/to/mythroad_res' ./build.sh
```

脚本安装锁定的依赖、检查 TypeScript 并生成根目录 `dist/`。默认资源目录为 `/Users/zixing/Downloads/mrp游戏大集结/mythroad_res`，其中的非隐藏常规文件会复制到 `dist/mythroad_res/`。将整个 `dist/` 上传到静态托管即可，支持部署到子目录；不需要 Node 服务。生产网页通过“打开 MRP 文件”加载游戏，不公开本机游戏库。缺少资源目录会明确中止构建，避免发布缺失资源的产物。

MIDI 默认使用 TinySynth GM，支持多种乐器、打击乐和 MIDI 控制器，无需在线下载音色库。也可选择“轻量方波”，切换时当前 MIDI 从头播放，选择保存在当前浏览器。TinySynth 使用 Apache-2.0 许可，随构建保留在 `licenses/`。网络拦截在后台运行，不向玩家展示调试配置。

网页入口已接入 Google AdSense 脚本，发布商 ID 为 `ca-pub-3251239894110421`，开发网页与静态构建均包含该脚本。

启用本地游戏库时，会自动读取该目录下的 `mythroad/`，把其中的字库、插件和已有下载资源按原相对路径挂载到游戏的内存文件系统。也可用 `MRP_SYSTEM_DIR=/path/to/mythroad` 单独指定。用户目录中的同名资源优先于内置组件；运行中的写入只影响本次会话。切换游戏时会刷新资源清单，批量兼容性测试使用同一目录并记录资源哈希。

打开终端显示的本地地址。方向键 / WASD 移动，Enter / 空格确认，Q / E 为左右软键；数字 0–9、*、# 对应原手机键盘。分辨率选择在下次加载时生效。普通上传模式下游戏在浏览器中运行；开发游戏库按需从本机服务器读取。

```bash
npm test
npm run typecheck
npm run build
npm run test:games -- '/path/to/mrp/collection' 40 /tmp/mrp-results.json
```

2026-09-07 完成两组各 40 个文件的抽测，覆盖 79 个不同路径、77 种文件内容。17 次输入冒烟通过，11 次游戏退出，4 次停在静态画面，48 次读取或运行报错。冒烟通过表示短流程内没有异常且按键期间画面有变化，**不等于游戏通关或完整可玩**。网页实玩步骤、限制和原始结果见 [本次兼容性记录](docs/compatibility/2026-09-07.md)。

网络地址拦截、下载映射与 `mythroad_res` 资源发布方式见 [本地下载与网络拦截](docs/network-interception.md)。

## 历史开发记录

Stage 5-C 收尾记录：guest inflate 完成；`arm_ext_call(0)` **NORMAL RETURN**；Lua **resumes**。Stage 5-C **COMPLETE**。Stage 5-D **STARTED**（event/frames/input 尚未闭环）。见 `docs/autonomous-progress.md`。
Stage 5-C.10R：生产 watchdog 下 guest inflate 完整完成；输出 SHA-256 与 reference gunzip 一致。当时停在 `table[30]`。见 `docs/stage5c10r-progress.md`。  
Stage 5-C.10Q：guest inflate 在 ARM/Thumb 内完成（1,404,897 insn）。可配置 ARM watchdog 默认 2e6 / 上限 20e6。当时生产停在 `table[30]`。见 `docs/stage5c10q-progress.md`。  
Stage 5-C.10P：实现 `table[9]` `memcmp2`（unsigned char，精确 `*su1-*su2`，early exit）。当时 LIVE gzip magic `1F 8B` equal，生产停在 ARM insn budget。见 `docs/stage5c10p-progress.md`。  
Stage 5-C.10N：`table[1]` / `mr_free` ownership + allocation header **只读取证**。当时**未实现** table[1]。当时生产停在 `table[1]`。见 `docs/stage5c10n-progress.md`。  
Stage 5-C.10M：实现 `table[3]` memcpy2（前向逐 byte，非 memmove）+ `table[10]` strcmp2（-1/0/1）。当时**未实现** `table[1]`。当时生产停在 `table[1]`。见 `docs/stage5c10m-progress.md`。  
Stage 5-C.10L：`table[3]` memcpy2 ABI + directory loop 只读取证，当时**未实现**。当时生产停在 `table[3]`。见 `docs/stage5c10l-progress.md`。  
Stage 5-C.10K：实现 current-pack 只读 file backend（table[40]/[44]/[45]/[41]）。当时生产停在 `table[3]` memcpy。见 `docs/stage5c10k-progress.md`。  
Stage 5-C.10J：current-pack file ABI 只读取证 + 只读 handle 设计。当时**未实现** table[40]/41+。当时生产停在 `table[40]`。见 `docs/stage5c10j-progress.md`。  
Stage 5-C.10I：实现 `table[100]` / `pack_filename` 128-byte data slot。当时生产停在 `table[40]`；LIVE filename 为 `"gssjxz.mrp"`。见 `docs/stage5c10i-progress.md`。  
Stage 5-C.10H：`table[40]` / `mr_open` 只读取证，**未实现**。当时空 filename 来自未写入的 `table[100]`。见 `docs/stage5c10h-progress.md`。  
Stage 5-C.10G：`table[17]` / `sprintf_` 仅 **literal + `%d`**。当时生产停在 `table[40]`。见 `docs/stage5c10g-progress.md`。  
Stage 5-C.10F：`table[17]` / `sprintf_` 只读取证，当时未实现。当时生产停在 `table[17]`。见 `docs/stage5c10f-progress.md`。  
Stage 5-C.10E：`table[33]` `mr_getTime` 接 `runtime.clock >>> 0`；当时停在 `table[17]`。见 `docs/stage5c10e-progress.md`。  
Stage 5-C.10D：`table[33]` / `asm_mr_getTime` 只读取证，**未实现**。当时生产停在 `table[33]`。见 `docs/stage5c10d-progress.md`。  
Stage 5-C.10C：`table[38]` 仅 `mr_platEx` code `0x4c6`（rxgj FULL `MR_SUCCESS`，无副作用）；真实 app 停在 `table[33]`。见 `docs/stage5c10c-progress.md`。  
Stage 5-C.10B：`table[130]` 仅 case 7（rxgj FULL）；当时停在 `table[38]`。见 `docs/stage5c10b-progress.md`。  
Stage 5-C.10A：真实 `app.mrp` 启动基线（实现 130 前停在 130）。见 `docs/stage5c10a-progress.md`。  
Stage 5-C.9：`table[38]` / `asm_mr_platEx` 只读取证，未实现。见 `docs/stage5c9-progress.md`。  
Stage 5-C.8：`mrc_init` 后继 BLX / `table[38]` platEx 取证，未实现。见 `docs/stage5c8-progress.md`。  
Stage 5-C.7：table[130] 返回值对 `mrc_init` 的依赖取证，未实现。见 `docs/stage5c7-progress.md`。  
Stage 5-C.6：table[130] / `asm_mr_TestCom` 只读取证，未实现。见 `docs/stage5c6-progress.md`。  
Stage 5-C.5：CONFIRMED table[14] memset ABI。见 `docs/stage5c5-progress.md`。  
Stage 5-C.4：恢复真实 cfunction.ext 初始化链。见 `docs/stage5c4-progress.md`。  
Stage 5-C.3：Real cfunction.ext Code-6 ABI Forensics。见 `docs/real-cfunction-code6.md`。  
Stage 5-C.2：Real EXT Loader ABI Wiring。见 `docs/stage5c2-progress.md`。  
Stage 5-C.1：Real Binary Readiness & Compatibility Gate。见 `docs/real-binary.md`。  
Stage 5-C：Mythroad 兼容层。见 `docs/stage5c-progress.md`。  
Stage 5-B：Mythroad Core Runtime。见 `docs/stage5b-progress.md`。  
Stage 5-A：MRP + Lua VM，见 `docs/stage5a-progress.md`。  
Stage 4：EXT ABI，见 `docs/stage4-progress.md`。  
后续可玩性回归见 `test/real/playable-gate.test.ts`。

```bash
npm test
npx tsx bench/run.ts
npx tsx tools/real/inspect.ts test/fixtures/real/app.mrp
npx tsx tools/real/startup-baseline.ts test/fixtures/real/app.mrp
npx tsx tools/real/forensics-33.ts test/fixtures/real/app.mrp
npx tsx tools/real/forensics-40.ts test/fixtures/real/app.mrp
npx tsx tools/real/forensics-3.ts test/fixtures/real/app.mrp
npx tsx tools/real/forensics-1.ts test/fixtures/real/app.mrp
```
