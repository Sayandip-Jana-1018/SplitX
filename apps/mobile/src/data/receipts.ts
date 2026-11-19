/**
 * Links that open a group's receipt photos. Photos taken on this phone open from the phone; the
 * rest live in a private bucket, and the server signs a link to each that works for an hour
 * (GET /api/v1/groups/:groupId/receipts). They are kept here for 50 minutes, so a gallery and the
 * expenses opened from it ask once, and offline the phone's own photos still show.
 */
import { useEffect, useState } from 'react';
import { api } from '~/api';
import { useLedger } from './LedgerProvider';

const KEEP_MS = 50 * 60_000;
const kept = new Map<string, { at: number; links: Record<string, string> }>();

/** A photo the phone took or picked, which needs no link from the server. */
export const onPhone = (uri: string | null | undefined): uri is string => Boolean(uri && !/^https?:/i.test(uri));

/** The signed links for a group's receipts, by expense id: empty until they arrive, and offline. */
export function useReceiptLinks(groupId: string | undefined): Record<string, string> {
    const { real } = useLedger();
    const [links, setLinks] = useState<Record<string, string>>(() => (groupId ? (kept.get(groupId)?.links ?? {}) : {}));

    useEffect(() => {
        if (!groupId || !real) return;
        const fresh = kept.get(groupId);
        if (fresh && Date.now() - fresh.at < KEEP_MS) return;
        let live = true;
        api.groupReceipts(groupId)
            .then(({ receipts }) => {
                const next = Object.fromEntries(receipts.map((receipt) => [receipt.expenseId, receipt.url]));
                kept.set(groupId, { at: Date.now(), links: next });
                if (live) setLinks(next);
            })
            .catch(() => undefined);
        return () => {
            live = false;
        };
    }, [groupId, real]);

    return links;
}
