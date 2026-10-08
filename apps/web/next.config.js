/** @type {import('next').NextConfig} */
const apiUrl = process.env.API_INTERNAL_URL || 'http://localhost:4000';

const nextConfig = {
  reactStrictMode: true,
  // This app is its own root; without this Next walks up to the repo root.
  outputFileTracingRoot: __dirname,
  // Same-origin proxy to NestJS — keeps cookies first-party and avoids CORS.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
};

module.exports = nextConfig;
