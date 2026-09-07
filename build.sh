#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

command -v node >/dev/null || { echo '请先安装 Node.js 20 或更新版本。' >&2; exit 1; }
node -e 'if (Number(process.versions.node.split(".")[0]) < 20) process.exit(1)' || { echo '需要 Node.js 20 或更新版本。' >&2; exit 1; }
export MRP_RESOURCE_DIR="${MRP_RESOURCE_DIR:-/Users/zixing/Downloads/mrp游戏大集结/mythroad_res}"
[[ -d "$MRP_RESOURCE_DIR" ]] || { echo "找不到资源目录：$MRP_RESOURCE_DIR，请设置 MRP_RESOURCE_DIR。" >&2; exit 1; }
# Resolve before Vite uses its web/ root, including paths containing spaces.
MRP_RESOURCE_DIR="$(cd -- "$MRP_RESOURCE_DIR" && pwd -P)"
export MRP_RESOURCE_DIR
npm ci --no-audit --no-fund
npm run typecheck
npm run build
echo '构建完成：dist/（含 mythroad_res）。将整个目录部署到静态网站即可。'
