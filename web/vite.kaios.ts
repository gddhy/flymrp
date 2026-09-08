import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import { gameBuild } from "./game-build.ts";
import kaiosGames from "../config/kaios-games.json";

const root = dirname(fileURLToPath(import.meta.url));
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, resolve(root, ".."), "MRP_"), ...process.env };
  const gameDir = env.MRP_GAME_DIR ?? "/Users/zixing/Downloads/mrp游戏大集结";
  return {
    root,
    base: "./",
    publicDir: resolve(root, "../assets"),
    define: { "import.meta.env.KAIOS": "true" },
    resolve: {
      alias: { "webaudio-tinysynth": resolve(root, "tinysynth-stub.ts") },
    },
    worker: { format: "iife" },
    esbuild: {
      // Gecko 48 already has these. esbuild cannot rewrite them, so keep the
      // rest of the firefox48 table (no BigInt, no object rest, no ??).
      supported: {
        "const-and-let": true,
        "for-of": true,
        "default-argument": true,
        "destructuring": true,
        "rest-argument": true,
        "array-spread": true,
        "template-literal": true,
        "arrow": true,
        "class": true,
        "generator": true,
      },
    },
    build: {
      outDir: resolve(root, "../dist-kaios"),
      emptyOutDir: true,
      target: "firefox48",
      cssTarget: "firefox48",
      modulePreload: false,
      sourcemap: false,
      assetsInlineLimit: 0,
      rollupOptions: { input: { index: resolve(root, "index.html"), main: resolve(root, "main.html") } },
    },
    plugins: [gameBuild(gameDir, kaiosGames.games)],
  };
});
