'use client';

import { usePathname } from 'next/navigation';

/**
 * template.tsx re-renders on EVERY route change in Next.js App Router.
 * Uses pure CSS animation instead of framer-motion to avoid hydration
 * mismatches (framer-motion injects inline styles during SSR).
 */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    return (
        <div className={pathname.endsWith('/print') ? 'print-document' : 'page-transition workspace-page'} data-page={pathname.split('/')[1]} suppressHydrationWarning>
            {children}
        </div>
    );
}
