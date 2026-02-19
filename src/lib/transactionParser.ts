/**
 * Transaction Parser — extracts amount, merchant, date, UPI ref from raw OCR / notification text.
 * Works with GPay, PhonePe, Paytm screenshots and Indian bank SMS formats.
 * Enhanced with line-item extraction for receipt scanning.
 */

export interface ReceiptLineItem {
    name: string;
    quantity: number;
    price: number;      // in paise
    confidence: number; // 0-100
}

export interface ParsedTransaction {
    amount: number | null;        // in paise
    merchant: string | null;
    method: string | null;        // gpay | phonepe | paytm | upi_other | card | cash
    upiRef: string | null;
    date: Date | null;
    confidence: number;           // 0-1
    rawText: string;
    items: ReceiptLineItem[];     // extracted line items
}

// ── Amount Patterns ──
const AMOUNT_PATTERNS = [
    /(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)/gi,
    /(?:amount|amt|paid|debited|credited)[:\s]*(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)/gi,
    /(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)\s*(?:paid|debited|sent|received)/gi,
];

// ── UPI Ref Patterns ──
const UPI_REF_PATTERNS = [
    /(?:UPI\s*(?:Ref|ref\.?|ID|Transaction\s*ID))[:\s#]*(\d{8,12})/gi,
    /(?:Ref\s*(?:No|Number|#))[:\s]*(\d{8,12})/gi,
    /(?:UTR)[:\s]*(\d{8,12})/gi,
];

// ── Method Detection ──
const METHOD_KEYWORDS: Record<string, string[]> = {
    gpay: ['google pay', 'gpay', 'g pay', 'tez'],
    phonepe: ['phonepe', 'phone pe'],
    paytm: ['paytm', 'pay tm'],
    card: ['credit card', 'debit card', 'card ending', 'visa', 'mastercard', 'rupay'],
};

// ── Merchant Patterns ──
const MERCHANT_PATTERNS = [
    /(?:paid to|sent to|transferred to|payment to|to)\s+([A-Za-z][\w\s&'.,-]{2,30})/gi,
    /(?:from)\s+([A-Za-z][\w\s&'.,-]{2,30})\s+(?:via|through)/gi,
    /(?:at)\s+([A-Za-z][\w\s&'.,-]{2,30})/gi,
];

// ── Line Item Patterns (for receipt scanning) ──
// Pattern: "2 x Coffee ₹240" or "2x Coffee 240.00" or "Coffee x2 ₹240"
const LINE_ITEM_PATTERNS = [
    // "2 x ItemName ₹120.00" or "2x ItemName 120"
    /^[\s]*(\d+)\s*[xX×]\s+(.+?)\s+(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)\s*$/,
    // "ItemName x2 ₹120.00"
    /^[\s]*(.+?)\s+[xX×]\s*(\d+)\s+(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)\s*$/,
    // "ItemName          ₹120.00" (large gap or tabs between name and price)
    /^[\s]*([A-Za-z][\w\s&'.,-]{2,30}?)\s{2,}(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)\s*$/,
    // "ItemName ... ₹120" (dots between)
    /^[\s]*([A-Za-z][\w\s&'.,-]{2,30}?)\s*\.{2,}\s*(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)\s*$/,
    // "1. Coffee ₹120" (numbered list)
    /^[\s]*\d+[.)]\s+(.+?)\s+(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)\s*$/,
];

// Words indicating summary/total lines (skip these)
const SKIP_KEYWORDS = [
    'total', 'subtotal', 'sub total', 'sub-total', 'grand total',
    'tax', 'gst', 'cgst', 'sgst', 'igst', 'vat', 'service charge',
    'discount', 'tip', 'gratuity', 'round off', 'round-off',
    'balance', 'change', 'cash', 'card', 'upi', 'net amount',
    'amount due', 'amount paid', 'payment', 'bill amount',
];

function extractAmount(text: string): number | null {
    for (const pattern of AMOUNT_PATTERNS) {
        pattern.lastIndex = 0;
        const match = pattern.exec(text);
        if (match) {
            const cleaned = match[1].replace(/,/g, '');
            const num = parseFloat(cleaned);
            if (num > 0 && num < 10_000_000) {
                return Math.round(num * 100); // to paise
            }
        }
    }
    return null;
}

function extractUpiRef(text: string): string | null {
    for (const pattern of UPI_REF_PATTERNS) {
        pattern.lastIndex = 0;
        const match = pattern.exec(text);
        if (match) return match[1];
    }
    return null;
}

function detectMethod(text: string): string | null {
    const lower = text.toLowerCase();
    for (const [method, keywords] of Object.entries(METHOD_KEYWORDS)) {
        if (keywords.some((kw) => lower.includes(kw))) return method;
    }
    if (lower.includes('upi')) return 'upi_other';
    return null;
}

function extractMerchant(text: string): string | null {
    for (const pattern of MERCHANT_PATTERNS) {
        pattern.lastIndex = 0;
        const match = pattern.exec(text);
        if (match) {
            return match[1].trim().replace(/\s+/g, ' ').slice(0, 40);
        }
    }
    return null;
}

function isSkipLine(text: string): boolean {
    const lower = text.toLowerCase().trim();
    return SKIP_KEYWORDS.some(k => lower.includes(k));
}

export function extractLineItems(rawText: string): ReceiptLineItem[] {
    const lines = rawText.split(/\r?\n/);
    const items: ReceiptLineItem[] = [];
    const seenNames = new Set<string>();

    for (const line of lines) {
        if (!line.trim() || isSkipLine(line)) continue;

        for (const pattern of LINE_ITEM_PATTERNS) {
            const match = line.match(pattern);
            if (!match) continue;

            let name: string;
            let quantity = 1;
            let priceStr: string;
            let confidence = 80;

            if (match.length === 4) {
                // Patterns with qty: either (qty, name, price) or (name, qty, price)
                const firstIsNum = /^\d+$/.test(match[1]);
                if (firstIsNum) {
                    quantity = parseInt(match[1]) || 1;
                    name = match[2].trim();
                    priceStr = match[3];
                    confidence = 90;
                } else {
                    name = match[1].trim();
                    quantity = parseInt(match[2]) || 1;
                    priceStr = match[3];
                    confidence = 85;
                }
            } else {
                // Patterns without qty: (name, price)
                name = match[1].trim();
                priceStr = match[2];
                confidence = 70;
            }

            // Clean and validate
            name = name.replace(/\s+/g, ' ').replace(/[.…]+$/, '').trim();
            if (name.length < 2 || name.length > 40) continue;

            const priceNum = parseFloat(priceStr.replace(/,/g, ''));
            if (isNaN(priceNum) || priceNum <= 0 || priceNum > 1_000_000) continue;

            // Deduplicate
            const key = name.toLowerCase();
            if (seenNames.has(key)) continue;
            seenNames.add(key);

            items.push({
                name,
                quantity,
                price: Math.round(priceNum * 100), // to paise
                confidence,
            });

            break; // matched this line, move to next
        }
    }

    return items;
}

export function parseTransactionText(rawText: string): ParsedTransaction {
    const amount = extractAmount(rawText);
    const upiRef = extractUpiRef(rawText);
    const method = detectMethod(rawText);
    const merchant = extractMerchant(rawText);
    const items = extractLineItems(rawText);

    // Confidence scoring
    let confidence = 0;
    if (amount) confidence += 0.4;
    if (merchant) confidence += 0.25;
    if (method) confidence += 0.2;
    if (upiRef) confidence += 0.15;

    return {
        amount,
        merchant,
        method,
        upiRef,
        date: new Date(),
        confidence,
        rawText,
        items,
    };
}
