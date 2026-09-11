import type { ReactNode } from 'react';
import { PublicShell } from '@/components/auth/AuthKit';

export default function AuthLayout({ children }: { children: ReactNode }) {
    return <PublicShell>{children}</PublicShell>;
}
