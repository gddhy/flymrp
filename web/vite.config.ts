import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  publicDir: resolve(root, "../assets"),
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: false,
    open: "/",
    fs: { allow: [resolve(root, "..")] },
  },
});
