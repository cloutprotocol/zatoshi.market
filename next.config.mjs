import { setupDevPlatform } from '@cloudflare/next-on-pages/next-dev';

// Configure dev platform for Cloudflare
if (process.env.NODE_ENV === 'development') {
  await setupDevPlatform();
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@noble/secp256k1'],
  typescript: {
    // Skip type checking during build - rely on separate tsc check
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true, // Required for Cloudflare Pages
  },
  webpack: (config, { webpack, isServer }) => {
    config.resolve = config.resolve || {};
    config.resolve.fallback = {
      ...(config.resolve.fallback || {}),
      buffer: false,
    };

    if (!isServer) {
      config.resolve.fallback.buffer = 'buffer';
    }

    config.plugins = config.plugins || [];
    config.plugins.push(
      new webpack.ProvidePlugin({
        Buffer: ['buffer', 'Buffer'],
      })
    );
    return config;
  },
};

export default nextConfig;
