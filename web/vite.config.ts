import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { localGames } from "./local-games.ts";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  publicDir: resolve(root, "../assets"),
  plugins: [localGames(process.env.MRP_GAME_DIR)],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: false,
    open: "/",
    fs: { allow: [resolve(root, "..")] },
  },
});
