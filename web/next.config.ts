import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // The SDK lives at ../sdk as TypeScript source with ESM-style ".js" import specifiers, which webpack
  // maps back to .ts through extensionAlias. Builds therefore run with --webpack.
  outputFileTracingRoot: path.resolve(import.meta.dirname, ".."),
  transpilePackages: ["@unlisted/sdk"],
  webpack: (config) => {
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return config;
  },
};

export default nextConfig;
