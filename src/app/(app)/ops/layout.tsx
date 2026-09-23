import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { Notice, PageIntro } from '@/components/ui/kit';
import { opsViewer } from '@/lib/ops/access';
import styles from './ops.module.css';

// The root layout adds "· SplitX".
export const metadata: Metadata = { title: 'Operations' };
export const dynamic = 'force-dynamic';

/**
 * /ops opens only for operators (OPS_ADMINS, lib/ops/access.ts), checked here
 * on the server before anything renders; its API checks again. Anyone else
 * signed in sees their own sign-in identity, which an operator can add.
 */
export default async function OpsLayout({ children }: { children: ReactNode }) {
    const viewer = await opsViewer();
    if (!viewer) redirect('/login?callbackUrl=%2Fops');
    if (viewer.allowed) return children;

    return (
        <div className={styles.page}>
            <PageIntro
                eyebrow="Operations"
                title="For SplitX's operators"
                subtitle="This page shows SplitX's live pipeline and platform. It opens for the accounts listed in OPS_ADMINS."
            />
            <Notice tone="info" title="Your sign-in">
                {viewer.identities.length > 0 ? (
                    <>
                        To open it, an operator adds one of these to OPS_ADMINS:{' '}
                        {viewer.identities.map((identity) => <code key={identity} className={styles.mono}>{identity} </code>)}
                    </>
                ) : (
                    'You signed in with a password. Operators sign in with Google or GitHub, whose account IDs the provider vouches for.'
                )}
            </Notice>
        </div>
    );
}
