import { setupDevPlatform } from '@cloudflare/next-on-pages/next-dev';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Configure dev platform for Cloudflare
if (process.env.NODE_ENV === 'development') {
  await setupDevPlatform();
}

/** @type {import('next').NextConfig} */
const SECURITY_HEADERS = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'geolocation=(), microphone=(), camera=()' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com",
      "style-src 'self' 'unsafe-inline' https://fonts.cdnfonts.com",
      "font-src 'self' https://fonts.cdnfonts.com",
      "img-src 'self' data: blob: https:",
      "object-src 'self' data:",
      "connect-src 'self' https: wss: http://135.181.6.234:3333",
      "frame-ancestors 'none'",
    ].join('; '),
  },
];

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@noble/secp256k1'],
  experimental: {
    externalDir: true,
  },
  typescript: {
    // Skip type checking during build - rely on separate tsc check
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true, // Required for Cloudflare Pages
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: SECURITY_HEADERS,
      },
    ];
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
