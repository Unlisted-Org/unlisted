import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// The SDK is consumed from source (../sdk/src). Its @solana/* imports must resolve to this app's
// copies so PublicKey instances are shared, hence the aliases and dedupe.
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@unlisted/sdk": here("../sdk/src/index.ts"),
      "@solana/web3.js": here("./node_modules/@solana/web3.js"),
      "@solana/spl-token": here("./node_modules/@solana/spl-token"),
      bs58: here("./node_modules/bs58"),
    },
    dedupe: ["@solana/web3.js", "@solana/spl-token", "bs58", "buffer"],
  },
  define: { global: "globalThis" },
  server: { fs: { allow: [here(".."), here("../sdk")] } },
  build: { target: "es2022", sourcemap: true },
});
