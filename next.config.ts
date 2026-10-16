import type { NextConfig } from "next";

// The FastAPI backend. Browser requests go to /api/* on this site and are proxied here, so
// the backend can stay on plain HTTP behind an HTTPS frontend (e.g. on Vercel).
const BACKEND_URL = (process.env.BACKEND_URL || "http://47.129.242.10:8000").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND_URL}/:path*` }];
  },
};

export default nextConfig;
