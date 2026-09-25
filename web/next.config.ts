import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // The SDK lives at ../sdk as TypeScript source with ESM-style ".js" import specifiers, which webpack
  // maps back to .ts through extensionAlias. Builds therefore run with --webpack.
  outputFileTracingRoot: path.resolve(import.meta.dirname, ".."),
  transpilePackages: ["@unlisted/sdk"],
  webpack: (config) => {
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    // The SDK's own dependencies resolve from web/node_modules: on a clean checkout (Vercel) ../sdk has
    // no node_modules of its own.
    config.resolve.modules = ["node_modules", path.resolve(import.meta.dirname, "node_modules")]; // nested lookup first, then web/node_modules as the fallback
    return config;
  },
};

export default nextConfig;
