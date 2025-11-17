/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@noble/secp256k1'],
  typescript: {
    // Skip type checking during build - rely on separate tsc check
    ignoreBuildErrors: true,
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
