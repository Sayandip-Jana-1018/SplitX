import { redirect } from 'next/navigation';

/**
 * /invite/[code] → redirect to /join/[code]
 * This page was a duplicate of /join/[code]. We now redirect to keep a single join flow.
 */
export default async function InviteRedirectPage({
    params,
}: {
    params: Promise<{ code: string }>;
}) {
    const { code } = await params;
    redirect(`/join/${code}`);
}
