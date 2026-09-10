#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

command -v node >/dev/null || { echo '请先安装 Node.js 20 或更新版本。' >&2; exit 1; }
node -e 'if (Number(process.versions.node.split(".")[0]) < 20) process.exit(1)' || { echo '需要 Node.js 20 或更新版本。' >&2; exit 1; }
export MRP_GAME_DIR="${MRP_GAME_DIR:-/Users/zixing/Downloads/mrp游戏大集结}"
[[ -d "$MRP_GAME_DIR" ]] || { echo "找不到游戏目录：$MRP_GAME_DIR，请设置 MRP_GAME_DIR。" >&2; exit 1; }
MRP_GAME_DIR="$(cd -- "$MRP_GAME_DIR" && pwd -P)"
export MRP_GAME_DIR
# KaiOS 2.x 按键机：只打 5 个经典游戏，不拷完整 mythroad_res。
if [[ ! -d node_modules ]]; then npm ci --no-audit --no-fund; fi
npm run typecheck
npm run build:kaios
echo '构建完成：dist-kaios/ 与 flymrp-kaios.zip。侧载到 KaiOS 2.x 后用方向键、确认键和左右软键操作。'
