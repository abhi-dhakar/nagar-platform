import { resolve } from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@nagar/ui"],
  allowedDevOrigins: ["*.e2b.app"],
  // Pin Turbopack to the workspace so pnpm symlinks and shared packages are visible.
  turbopack: { root: resolve(process.cwd(), "../..") },
};

export default nextConfig;
