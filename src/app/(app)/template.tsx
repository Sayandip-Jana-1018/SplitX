'use client';

/**
 * template.tsx re-renders on EVERY route change in Next.js App Router.
 * Using a simple wrapper without framer-motion initial animation
 * to avoid hydration mismatch between server and client.
 */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
