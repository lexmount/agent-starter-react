import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  assetPrefix: '.',
  allowedDevOrigins: ['liveavatar.local.lexmount.net'],
  transpilePackages: ['@lexmount/agentwidget-sdk'],
};

export default nextConfig;
