import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Environment variables
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
  },
  // Vercel Deployment Configuration
  productionBrowserSourceMaps: false,
  swcMinify: true,
  compress: true,
  // API Routes Configuration
  api: {
    responseLimit: "50mb",
  },
  // Headers for API requests
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
