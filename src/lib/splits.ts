/**
 * Equal shares of an amount in paise. The leftover paise go one each to the
 * first shares, so the shares always add up to the amount exactly and no one
 * pays more than one paisa above anyone else.
 */
export function equalShares(amount: number, count: number): number[] {
    const perPerson = Math.floor(amount / count);
    const remainder = amount - perPerson * count;
    return Array.from({ length: count }, (_, i) => perPerson + (i < remainder ? 1 : 0));
}

/**
 * Equal shares keyed by user, in one fixed order: people sorted by ID. The
 * composer's preview and the server both call this, so the extra paisa lands
 * on the same person whichever of them computes it, and whatever order the
 * members were listed or ticked in.
 */
export function equalSharesById(amount: number, userIds: readonly string[]): Map<string, number> {
    const ordered = [...new Set(userIds)].sort();
    const shares = equalShares(amount, ordered.length);
    return new Map(ordered.map((userId, i) => [userId, shares[i]]));
}
