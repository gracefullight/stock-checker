import { withSerwist } from '@serwist/turbopack';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@stock-checker/core'],
};

export default withSerwist(nextConfig);
