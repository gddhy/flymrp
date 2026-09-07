#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

command -v node >/dev/null || { echo '请先安装 Node.js 20 或更新版本。' >&2; exit 1; }
node -e 'if (Number(process.versions.node.split(".")[0]) < 20) process.exit(1)' || { echo '需要 Node.js 20 或更新版本。' >&2; exit 1; }
export MRP_GAME_DIR="${MRP_GAME_DIR:-/Users/zixing/Downloads/mrp游戏大集结}"
[[ -d "$MRP_GAME_DIR" ]] || { echo "找不到游戏目录：$MRP_GAME_DIR，请设置 MRP_GAME_DIR。" >&2; exit 1; }
MRP_GAME_DIR="$(cd -- "$MRP_GAME_DIR" && pwd -P)"
export MRP_RESOURCE_DIR="${MRP_RESOURCE_DIR:-$MRP_GAME_DIR/mythroad_res}"
[[ -d "$MRP_RESOURCE_DIR" ]] || { echo "找不到资源目录：$MRP_RESOURCE_DIR，请设置 MRP_RESOURCE_DIR。" >&2; exit 1; }
# Resolve before Vite uses its web/ root, including paths containing spaces.
MRP_RESOURCE_DIR="$(cd -- "$MRP_RESOURCE_DIR" && pwd -P)"
export MRP_RESOURCE_DIR
npm ci --no-audit --no-fund
npm run typecheck
npm run build
echo '构建完成：dist/（含游戏库与 mythroad_res，未变化文件已跳过）。将整个目录部署到静态网站即可。'
