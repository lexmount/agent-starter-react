import type { NextConfig } from 'next';

const runtimeDistDir = process.env.NEXT_DIST_DIR?.trim();
const runtimeTsconfigPath = process.env.NEXT_TSCONFIG_PATH?.trim();

const nextConfig: NextConfig = {
  assetPrefix: '.',
  allowedDevOrigins: ['liveavatar.local.lexmount.net'],
  distDir: runtimeDistDir || '.next',
  typescript: runtimeTsconfigPath
    ? { tsconfigPath: runtimeTsconfigPath }
    : undefined,
};

export default nextConfig;
