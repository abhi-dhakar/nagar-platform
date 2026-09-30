import { resolve } from "node:path";
import type { NextConfig } from "next";

const apiOrigin = process.env.NAGAR_API_INTERNAL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  transpilePackages: ["@nagar/ui"],
  allowedDevOrigins: ["*.e2b.app"],
  // Pin Turbopack to the workspace so pnpm symlinks and shared packages are visible.
  turbopack: { root: resolve(process.cwd(), "../..") },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${apiOrigin}/api/:path*` },
      { source: "/git/:path*", destination: `${apiOrigin}/git/:path*` },
    ];
  },
};

export default nextConfig;
