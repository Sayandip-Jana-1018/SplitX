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

/**
 * Generate specific app intent links for popular UPI apps
 */
export function getAppSpecificLinks(params: UpiPayParams) {
    const base = generateUpiLink(params);
    return {
        generic: base,
        gpay: `gpay://upi/${base.replace('upi://', '')}`,
        phonepe: `phonepe://pay?${new URLSearchParams({
            pa: params.upiId,
            pn: params.payeeName,
            am: params.amount.toFixed(2),
            cu: params.currency || 'INR',
            tn: params.note || 'SplitX Settlement',
        }).toString()}`,
        paytm: base, // Paytm supports standard upi:// scheme
    };
}

/**
 * Open UPI payment link. Falls back to generic upi:// if app-specific fails.
 */
export function openUpiPayment(params: UpiPayParams): void {
    const link = generateUpiLink(params);
    window.location.href = link;
}

/**
 * Generate a WhatsApp reminder message with payment link
 */
export function generateReminder(
    fromName: string,
    toName: string,
    amount: number,
    upiId?: string
): string {
    let msg = `Hey ${toName}! 👋\n\nYou owe ${fromName} ₹${amount.toLocaleString('en-IN')} from our trip expenses on SplitX.`;
    if (upiId) {
        msg += `\n\nPay via UPI: ${upiId}`;
    }
    msg += '\n\nSettle up when you can! 🙏';
    return msg;
}

/**
 * Open WhatsApp with pre-filled reminder message
 */
export function sendWhatsAppReminder(phone: string, message: string): void {
    const encodedMsg = encodeURIComponent(message);
    const cleanPhone = phone.replace(/\D/g, '');
    window.open(`https://wa.me/${cleanPhone}?text=${encodedMsg}`, '_blank');
}
