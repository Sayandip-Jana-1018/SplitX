import type { NextConfig } from 'next';
import withPWAInit from '@ducanh2912/next-pwa';

const withPWA = withPWAInit({
  dest: 'public',
  cacheOnFrontEndNav: false,
  aggressiveFrontEndNavCaching: false,
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === 'development',
  extendDefaultRuntimeCaching: true,
  workboxOptions: {
    // A new deploy must take over immediately — otherwise the old worker keeps
    // serving chunks that no longer exist and the app throws on navigation.
    skipWaiting: true,
    clientsClaim: true,
    cleanupOutdatedCaches: true,
    navigateFallbackDenylist: [/^\/api\//],
    runtimeCaching: [
      {
        // Never cache auth-related API calls
        urlPattern: /\/api\/auth\/.*/i,
        handler: 'NetworkOnly' as const,
      },
      {
        // Always go to network for user session check
        urlPattern: /\/api\/me/i,
        handler: 'NetworkOnly' as const,
      },
    ],
  },
});

const nextConfig: NextConfig = {
  output: 'standalone',
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

export default withPWA(nextConfig);
