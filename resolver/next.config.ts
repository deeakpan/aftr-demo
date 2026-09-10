import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(projectRoot, "..");

loadEnvConfig(repoRoot);

const nextConfig: NextConfig = {
  outputFileTracingRoot: repoRoot,
  experimental: {
    externalDir: true,
  },
  webpack: (config, { isServer }) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@": repoRoot,
    };
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        crypto: false,
        os: false,
        path: false,
      };
    }
    return config;
  },
};

export default nextConfig;
