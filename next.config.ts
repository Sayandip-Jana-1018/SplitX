import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  // Load these from node_modules once per process instead of bundling a copy
  // into each server entry point. Separate copies split the metrics registry
  // and the OpenTelemetry context that instrumentation relies on.
  serverExternalPackages: ['prom-client', '@opentelemetry/api', '@opentelemetry/sdk-trace-node', 'ioredis'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
      {
        protocol: 'https',
        hostname: 'res.cloudinary.com',
      },
      {
        protocol: 'https',
        hostname: 'msbynsdxjjxegrmaefgl.supabase.co',
      },
    ],
  },
  async headers() {
    return [
      {
        // The browser checks the service worker for updates; never let a CDN
        // or the browser's HTTP cache answer that check with an old copy.
        source: '/sw.js',
        headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }],
      },
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
        ],
      },
    ];
  },
  turbopack: {},
};

export default nextConfig;
