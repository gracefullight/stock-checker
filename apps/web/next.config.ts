import { withSerwist } from '@serwist/turbopack';
import type { NextConfig } from 'next';
import { apiProxyRewrites, resolveApiOrigin } from './src/lib/api-proxy';

const nextConfig: NextConfig = {
  transpilePackages: ['@stock-checker/core'],
  // Browsers call same-origin /api/*; Next forwards it to the Fastify server so
  // the dashboard works from a phone or any host without a per-device env.
  async rewrites() {
    return apiProxyRewrites(
      resolveApiOrigin({
        API_URL: process.env.API_URL,
        NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
      })
    );
  },
};

export default withSerwist(nextConfig);
