import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  serverExternalPackages: ["better-sqlite3", "@napi-rs/canvas"],
  productionBrowserSourceMaps: false,
  compiler: {
    // Strip console.* from production client bundles.
    removeConsole: process.env.NODE_ENV === "production" ? { exclude: ["error", "warn"] } : false,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "30mb",
    },
  },
  // Note on JS hardening: Next 15 minifies and content-hashes all chunks by
  // default (e.g. `_next/static/chunks/[hash].js`), so each deploy produces
  // brand-new asset URLs. Combined with the dynamic `/sw.js` (no-cache,
  // build-stamped) and the auto-reload in PWARegister, mobile installs pick
  // up new builds on the next page load. Aggressive JS obfuscation is
  // intentionally NOT enabled — webpack-obfuscator is known to break React
  // Server Components and Next.js streaming.
};

export default config;
