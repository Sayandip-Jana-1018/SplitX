/**
 * Equal shares of an amount in paise. The first share absorbs the remainder,
 * so the shares always add up to the amount exactly.
 */
export function equalShares(amount: number, count: number): number[] {
    const perPerson = Math.floor(amount / count);
    const remainder = amount - perPerson * count;
    return Array.from({ length: count }, (_, i) => perPerson + (i === 0 ? remainder : 0));
}
