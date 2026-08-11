import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // `standalone` keeps the production image small — Next traces only the files
  // actually imported instead of shipping all of node_modules.
  output: "standalone",
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
