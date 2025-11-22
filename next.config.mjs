import { setupDevPlatform } from '@cloudflare/next-on-pages/next-dev';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

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
      // Don't polyfill Node core on server/edge bundles
      buffer: false,
    };

    if (!isServer) {
      // Polyfill Node APIs for browser bundles (bitcore-lib-zcash needs crypto)
      config.resolve.fallback = {
        ...config.resolve.fallback,
        buffer: 'buffer',
        crypto: require.resolve('crypto-browserify'),
        stream: require.resolve('stream-browserify'),
        assert: require.resolve('assert'),
        util: require.resolve('util'),
      };

      config.resolve.alias = {
        ...(config.resolve.alias || {}),
        crypto: require.resolve('crypto-browserify'),
      };
    }

    config.plugins = config.plugins || [];
    config.plugins.push(
      new webpack.ProvidePlugin({
        Buffer: ['buffer', 'Buffer'],
        process: ['process'],
      })
    );
    return config;
  },
};

export default nextConfig;
