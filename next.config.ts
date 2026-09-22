import type { NextConfig } from 'next';
import { CONTENT_SECURITY_POLICY, PERMISSIONS_POLICY } from './src/lib/security/contentSecurityPolicy';

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
          { key: 'Permissions-Policy', value: PERMISSIONS_POLICY },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          // Production only: development runs over plain HTTP and its tooling
          // uses eval. The CSP is report-only until production shows no
          // violations from the app itself (lib/security/contentSecurityPolicy.ts).
          // Vercel sends its own HSTS; the cluster and CloudFront need this one.
          ...(process.env.NODE_ENV === 'production'
            ? [
              { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
              { key: 'Content-Security-Policy-Report-Only', value: CONTENT_SECURITY_POLICY },
            ]
            : []),
        ],
      },
    ];
  },
  turbopack: {},
};

export default nextConfig;
