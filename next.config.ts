import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      allowedOrigins: ["localhost:3000", "nexthorizon-ai.com"],
    },
  },
};

export default nextConfig;
