/**
 * UPI Deep Link Generator
 *
 * Generates `upi://pay?...` links that open the user's preferred UPI app
 * (GPay, PhonePe, Paytm, etc.) for settlement payments.
 *
 * No payment processing on our side — zero compliance burden.
 */

export interface UpiPayParams {
    /** Payee UPI ID, e.g. "priya@okaxis" */
    upiId: string;
    /** Payee display name */
    payeeName: string;
    /** Amount in rupees (not paise) */
    amount: number;
    /** Transaction note */
    note?: string;
    /** Currency (default: INR) */
    currency?: string;
}

/**
 * Generate a UPI deep link URL
 */
export function generateUpiLink({
    upiId,
    payeeName,
    amount,
    note = 'SplitX Settlement',
    currency = 'INR',
}: UpiPayParams): string {
    const params = new URLSearchParams({
        pa: upiId,
        pn: payeeName,
        am: amount.toFixed(2),
        cu: currency,
        tn: note,
    });
    return `upi://pay?${params.toString()}`;
}
