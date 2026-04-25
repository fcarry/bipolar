import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  serverExternalPackages: ["better-sqlite3", "@napi-rs/canvas"],
  productionBrowserSourceMaps: false,
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
  // Server Components and Next.js streaming. `compiler.removeConsole` is also
  // disabled because it strips server-side logs (cron, migrations) too.
};

export default config;
