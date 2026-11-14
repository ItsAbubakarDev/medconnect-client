import type { NextConfig } from "next";

// The FastAPI backend. Browser requests go to /api/* on this site and are proxied to it.
// Set BACKEND_URL wherever the site is built and run. In development it defaults to a backend
// on this machine; a production build without it stops, rather than quietly sending requests
// somewhere unintended. The hop from this server to the backend is its own connection, which
// the patient's HTTPS doesn't cover, so in production use https:// or a private address.
const isProduction = process.env.NODE_ENV === "production";
const configured = process.env.BACKEND_URL || (isProduction ? "" : "http://127.0.0.1:8000");
if (!configured) {
  throw new Error(
    "BACKEND_URL is not set. Set it to the backend's address (https://… or a private network address) before building or starting the site.",
  );
}
const BACKEND_URL = configured.replace(/\/+$/, "");
const backendHost = new URL(BACKEND_URL).hostname;
const isPrivateHost =
  backendHost === "localhost" ||
  /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(backendHost) ||
  backendHost.endsWith(".internal") ||
  backendHost.endsWith(".local");
if (isProduction && BACKEND_URL.startsWith("http://") && !isPrivateHost) {
  console.warn(
    `⚠ BACKEND_URL (${BACKEND_URL}) is plain HTTP over the public internet: health data between this server and the backend is not encrypted. Use https:// or a private network address.`,
  );
}

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
