import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import { localSystem } from "./local-system.ts";
import { localGames } from "./local-games.ts";
import { resourceBuild } from "./resource-build.ts";

const root = dirname(fileURLToPath(import.meta.url));
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, resolve(root, ".."), "MRP_"), ...process.env };
  const systemDir = env.MRP_SYSTEM_DIR ?? (env.MRP_GAME_DIR ? resolve(env.MRP_GAME_DIR, "mythroad") : undefined);
  const resourceDir = env.MRP_RESOURCE_DIR ?? (env.MRP_GAME_DIR ? resolve(env.MRP_GAME_DIR, "mythroad_res") : undefined);
  return {
    root, base: "./", build: { outDir: resolve(root, "../dist"), emptyOutDir: true }, publicDir: resolve(root, "../assets"),
    plugins: [localGames(env.MRP_GAME_DIR), localSystem(systemDir), localSystem(resourceDir, true), resourceBuild(resourceDir)],
    server: { host: "127.0.0.1", port: 5173, strictPort: false, open: "/", fs: { allow: [resolve(root, "..")] } },
  };
});
