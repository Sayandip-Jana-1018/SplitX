'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft, House } from 'lucide-react';
import Button from '@/components/ui/Button';
import { AuthCard, PublicShell } from '@/components/auth/AuthKit';
import styles from '@/components/auth/auth.module.css';

export default function NotFound() {
    const router = useRouter();

    return (
        <PublicShell>
            <AuthCard
                icon={<span className={styles.bigCode}>404</span>}
                title="This page wandered off"
                subtitle="The link may be broken, or the page has moved."
            >
                <div className={styles.actions}>
                    <Button fullWidth size="lg" leftIcon={<House size={18} />} onClick={() => router.push('/dashboard')}>
                        Go to Home
                    </Button>
                    <Button fullWidth variant="ghost" leftIcon={<ArrowLeft size={16} />} onClick={() => router.back()}>
                        Go back
                    </Button>
                </div>
            </AuthCard>
        </PublicShell>
    );
}
