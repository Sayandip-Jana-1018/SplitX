import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * Who may open /ops. Operators are listed in OPS_ADMINS by the account their
 * sign-in provider gave them, as `provider:accountId` (for example
 * `github:12345678,google:109876543210`): an ID the provider vouches for, not
 * an email address someone could register first. A password account has no
 * such ID, so it is never an operator.
 */

export interface OpsViewer {
    allowed: boolean;
    /** The viewer's own sign-in identities, shown to them so an operator can add one. */
    identities: string[];
}

export function operatorList(value = process.env.OPS_ADMINS): Set<string> {
    return new Set((value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean));
}

/** The signed-in viewer and whether they are an operator; null when nobody is signed in. */
export async function opsViewer(): Promise<OpsViewer | null> {
    const session = await auth();
    const email = session?.user?.email;
    if (!email) return null;

    const user = await prisma.user.findUnique({
        where: { email },
        select: { accounts: { select: { provider: true, providerAccountId: true } } },
    });
    if (!user) return null;

    const identities = user.accounts.map((account) => `${account.provider}:${account.providerAccountId}`);
    const operators = operatorList();
    return { allowed: identities.some((identity) => operators.has(identity)), identities };
}
