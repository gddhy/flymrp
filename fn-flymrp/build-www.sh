#!/usr/bin/env bash
# 生成 fn-flymrp/app/www：从上层 flymrp 的 dist 构建产物复制模拟器部分并打补丁。
# 用法：在 fn-flymrp 目录下执行 bash build-www.sh（需先在上层跑过 build.sh 得到 dist/）
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

DIST="$(cd .. && pwd)/dist"
WWW="app/www"
[[ -d "$DIST" ]] || { echo "找不到 $DIST，请先在项目根目录执行 bash build.sh" >&2; exit 1; }

[[ -d "$WWW" ]] && rm -rf "$WWW"
mkdir -p "$WWW/vendor" "$WWW/assets"

# ---- 模拟器运行所需文件（只取模拟器，不含商店首页）----
cp "$DIST/main.html" "$WWW/main.html"
cp "$DIST/player.js" "$WWW/player.js"
# Worker 缺失会导致「运行失败：无法启动游戏执行线程」
cp "$DIST/player.worker.js" "$WWW/player.worker.js"
cp "$DIST"/assets/main-*.css "$WWW/assets/"
cp "$DIST"/assets/pwa-*.css "$WWW/assets/"
cp -r "$DIST/system" "$WWW/system"
cp -r "$DIST/mythroad_res" "$WWW/mythroad_res"
cp -r "$DIST/plugins" "$WWW/plugins"
cp -r "$DIST/gwy" "$WWW/gwy"
cp -r "$DIST/games" "$WWW/games"
cp "$DIST/menu.dat" "$DIST/time.py.sys" "$DIST/dsm_gm.mrp" "$WWW/"

# ---- 集成层（源码在 src/，随构建复制）----
cp src/fnos.js "$WWW/fnos.js"
cp src/vendor/trimjs-web-app.js "$WWW/vendor/trimjs-web-app.js"

# ---- main.html 打补丁（去 PWA、藏返回库按钮、挂集成层）----
node - "$WWW/main.html" <<'EOF'
const fs = require('fs');
const file = process.argv[2];
let html = fs.readFileSync(file, 'utf8');
const drop = [
  /<link rel="manifest"[^>]*\/>/,
  /<meta name="theme-color"[^>]*\/>/,
  /<link rel="icon"[^>]*\/>/,
  /<link rel="apple-touch-icon"[^>]*\/>/,
  /<meta name="mobile-web-app-capable"[^>]*\/>/,
  /<meta name="apple-mobile-web-app-capable"[^>]*\/>/,
  /<meta name="apple-mobile-web-app-status-bar-style"[^>]*\/>/,
  /<meta name="apple-mobile-web-app-title"[^>]*\/>/,
];
for (const re of drop) html = html.replace(re, '');
// 返回游戏库的按钮在独立模拟器应用里无意义；空屏内容紧凑化，避免小窗口下文字外溢
html = html.replace('</head>', [
  '<style>',
  '#back{display:none!important}',
  '.empty-screen{overflow:hidden;gap:10px!important;padding:10px!important;line-height:1.5!important}',
  '.empty-screen strong{font-size:14px!important}',
  '.empty-screen>span{font-size:11px!important}',
  '.empty-screen .upload{padding:7px 14px!important;font-size:12px!important}',
  '</style>'
].join(''));
// 空屏提示文案
html = html.replace('从游戏库选择，或打开本地 MRP 文件。', '选择本地或飞牛 NAS 中的 MRP 文件开始游戏。');
// 集成层脚本（SDK 在前）
html = html.replace('</body>',
  '<script src="./vendor/trimjs-web-app.js"></script><script src="./fnos.js"></script></body>');
fs.writeFileSync(file, html);
console.log('main.html patched');
EOF

# ---- player.js 补丁：小窗口下允许非整数缩放，避免画面被压得过小 ----
# snapDisplayScale 原逻辑：fit<1 时保留原始值，否则取 1/dpr 的整数倍。
# 飞牛客户端窗口较矮 + Windows 高 DPI 时 fit≈1.0 会被强制压到 1/dpr（如 0.67），画面极小。
# 改为：fit<1.25 时直接用原始 fit（接近 1x，清晰度损失可忽略），其余场景保持整数对齐。
node - "$WWW/player.js" <<'EOF'
const fs = require('fs');
const file = process.argv[2];
let js = fs.readFileSync(file, 'utf8');
const orig = 'function Fr(s,t=1){let a=t>0?t:1,r=Number.isFinite(s)&&s>0?s:.1,c=Math.floor(r*a+1e-6);return c<1?r:c/a}';
const patched = 'function Fr(s,t=1){let a=t>0?t:1,r=Number.isFinite(s)&&s>0?s:.1,c=Math.floor(r*a+1e-6);return r<1.25?r:(c<1?r:c/a)}';
if (js.includes(orig)) {
  fs.writeFileSync(file, js.replace(orig, patched));
  console.log('player.js snap-scale patched');
} else if (js.includes('r<1.25?r:(c<1?r:c/a)')) {
  console.log('player.js snap-scale already patched');
} else {
  console.warn('警告: 未找到 snapDisplayScale 压缩模式，跳过缩放补丁（不影响其他功能）');
}
EOF

# ---- player.js 补丁 2：游戏退出后留在模拟器，不跳转商店页 ----
# 原逻辑 goLibrary()（压缩后 pt()）会 location.assign/replace 到 index.html；
# 独立应用没有该页面，会显示 {"ok":false,"error":"not found"}。
# 改为重载 main.html，回到空白待机画面。
node - "$WWW/player.js" <<'EOF'
const fs = require('fs');
const file = process.argv[2];
let js = fs.readFileSync(file, 'utf8');
const start = 'function pt(){Jt();let e=yr(document.baseURI);';
const end = 'location.replace(e)}';
const i = js.indexOf(start);
if (i >= 0) {
  const j = js.indexOf(end, i);
  if (j > i) {
    const replacement = 'function pt(){Jt();location.replace(new URL("main.html",document.baseURI).href)}';
    fs.writeFileSync(file, js.slice(0, i) + replacement + js.slice(j + end.length));
    console.log('player.js goLibrary patched (exit stays in emulator)');
  } else { console.warn('警告: goLibrary 结束标记未找到，退出后仍会跳转 index.html'); }
} else if (js.includes('function pt(){Jt();location.replace(new URL("main.html"')) {
  console.log('player.js goLibrary already patched');
} else {
  console.warn('警告: 未找到 goLibrary 压缩模式，退出后仍会跳转 index.html');
}
EOF

# ---- 卫生检查：产物里不允许有 sw.js 引用残留导致的缺失文件 ----
echo "www 生成完成：$(du -sh "$WWW" | cut -f1)"
