'use client';

/**
 * template.tsx re-renders on EVERY route change in Next.js App Router.
 * Uses pure CSS animation instead of framer-motion to avoid hydration
 * mismatches (framer-motion injects inline styles during SSR).
 */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
    return (
        <div className="page-transition" suppressHydrationWarning>
            {children}
        </div>
    );
}
