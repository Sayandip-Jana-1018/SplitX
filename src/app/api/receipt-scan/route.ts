import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { takeAiQuota } from '@/lib/aiQuota';
import { recordReceiptScan } from '@/lib/metrics';
import { logger } from '@/lib/logger';
import { adjustmentLooksWrong } from '@/lib/receiptSplit';
import { formatCurrency } from '@/lib/utils';

/**
 * POST /api/receipt-scan — Advanced AI receipt scanning via OpenAI GPT-4o-mini vision.
 * Accepts: { image: string (base64 data URL) }
 * Returns: Structured receipt data with items, taxes, totals.
 */

interface ReceiptItem {
    name: string;
    quantity: number;
    price: number;      // the row's total (quantity × unit price), in paise
}

interface ReceiptScanResult {
    merchant: string | null;
    date: string | null;
    items: ReceiptItem[];
    subtotal: number;   // paise
    taxes: Record<string, number>; // e.g. { CGST: 1702, SGST: 1702 }
    total: number;       // paise
    /** ISO 4217 code of the amounts as printed. SplitX records rupees, so the page warns about any other. */
    currency: string;
    category: string;
    confidence: number;
    notes: string | null; // warnings about pricing inconsistencies
}

const SYSTEM_PROMPT = `You are an expert receipt parser with perfect vision. Given a receipt image, extract ALL structured data with 99% accuracy.
Return ONLY valid JSON with this exact schema (no markdown, no explanation, no code fences):
{
  "merchant": "Store/Restaurant Name" or null,
  "date": "YYYY-MM-DD" or null,
  "items": [
    { "name": "Item name", "quantity": 1, "price": 120.00 }
  ],
  "subtotal": 500.00,
  "taxes": { "CGST": 25.00, "SGST": 25.00 },
  "total": 550.00,
  "currency": "INR",
  "category": "food|transport|shopping|entertainment|bills|health|education|general",
  "confidence": 0.95,
  "notes": null
}

CRITICAL RULES for 99% ACCURACY:

MOST IMPORTANT — TOTAL AMOUNT:
1. ALWAYS look for the FINAL "Payment", "Grand Total", "Amount Due", "Total Payable", or "Net Amount" printed on the receipt. This is the single source of truth for "total". Copy this number EXACTLY. Do NOT compute the total yourself.
2. The "total" field MUST be the EXACT printed payment/grand-total amount. Never sum items to derive the total — always read it directly from the receipt.
3. If multiple totals appear (subtotal, total, grand total, payment), use the LAST/LARGEST one that represents what was actually charged/paid.

ITEM EXTRACTION:
4. Prices MUST be in the ORIGINAL CURRENCY as exact decimals (e.g., 120.50 for ₹120.50). Do NOT convert currencies. Set "currency" to the ISO 4217 code of that currency (₹, Rs or INR is "INR"; $ in the US is "USD"; € is "EUR"). If the receipt shows no currency, use "INR".
5. Include EVERY SINGLE ITEM listed. Do not skip or summarize items.
6. "price" inside "items" must be the TOTAL price for that item row (quantity × unit price) as printed on the receipt.
7. If quantity is missing, default to 1.
8. Exclude "Total", "Subtotal", "Tax", and "Discount" rows from the "items" array. Only actual products/services go in "items".

TAXES & FEES:
9. Extract all taxes (CGST, SGST, Service Charge, VAT, GST, etc.) into the "taxes" object. If tax type is unclear, use "Tax".
10. Include service charges, delivery fees, packing charges etc. in taxes with descriptive keys.

VALIDATION:
11. After extraction, compare: sum of item prices vs subtotal, and subtotal + taxes vs total. If there is any mismatch, STILL use the printed total — do NOT adjust it. Instead, add a note in "notes" explaining the discrepancy (e.g., "Item prices sum to ₹X but printed subtotal is ₹Y").
12. If individual item prices seem inconsistent or unreasonably priced, note this in "notes" but still extract them as printed.
13. If the image is blurry/unreadable and you cannot find a total, set confidence below 0.3.

GENERAL:
14. Ignore headers, footers, phone numbers, table numbers, QR codes, and wifi passwords.
15. "notes" should be null if everything is consistent, or a brief string describing any pricing discrepancies found.
Always return raw JSON.`;

/**
 * The scan page shrinks photos to about 2,048 pixels before sending, which is
 * all the vision model reads at high detail, so a real receipt is well under
 * this. It also keeps under Vercel's 4.5 MB limit on a request.
 */
const MAX_IMAGE_CHARS = 4_000_000;
const IMAGE_DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

export async function POST(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            return NextResponse.json(
                { error: 'OpenAI API key not configured. Add OPENAI_API_KEY to your .env file.' },
                { status: 503 }
            );
        }

        if (Number(req.headers.get('content-length') || 0) > MAX_IMAGE_CHARS + 1_000) {
            return NextResponse.json({ error: 'That photo is too large to scan. Try again from the camera, or use on-device mode.' }, { status: 413 });
        }
        const body = await req.json().catch(() => null) as { image?: unknown } | null;
        const image = typeof body?.image === 'string' ? body.image : '';
        if (image.length > MAX_IMAGE_CHARS) {
            return NextResponse.json({ error: 'That photo is too large to scan. Try again from the camera, or use on-device mode.' }, { status: 413 });
        }
        if (!IMAGE_DATA_URL.test(image)) {
            return NextResponse.json(
                { error: 'Send a JPEG, PNG or WebP photo of the receipt.' },
                { status: 400 }
            );
        }

        const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        const quota = await takeAiQuota('receipt', user.id);
        if (!quota.ok) {
            return NextResponse.json(
                { error: `${quota.error} On-device scanning still works.` },
                { status: quota.status, headers: quota.retryAfterSeconds ? { 'Retry-After': String(quota.retryAfterSeconds) } : undefined }
            );
        }

        // Call OpenAI Vision API
        let openaiRes: Response;
        try {
            openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
                signal: AbortSignal.timeout(45_000),
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    messages: [
                        { role: 'system', content: SYSTEM_PROMPT },
                        {
                            role: 'user',
                            content: [
                                { type: 'text', text: 'Parse this receipt. IMPORTANT: Read the final Payment/Grand Total amount directly from the receipt — do NOT compute it from items. Return structured JSON:' },
                                {
                                    type: 'image_url',
                                    image_url: { url: image, detail: 'high' },
                                },
                            ],
                        },
                    ],
                    max_tokens: 2000,
                    temperature: 0.1,
                }),
            });
        } catch (error) {
            const name = (error as { name?: string })?.name;
            recordReceiptScan('upstream_error');
            return NextResponse.json(
                {
                    error: name === 'TimeoutError' || name === 'AbortError'
                        ? 'The AI scan took too long. Try again, or use on-device mode.'
                        : 'Couldn’t reach the AI service. Try again, or use on-device mode.',
                },
                { status: 504 }
            );
        }

        if (!openaiRes.ok) {
            const err = await openaiRes.text();
            logger.error('OpenAI API error', { status: openaiRes.status, body: err.slice(0, 500) });
            recordReceiptScan(openaiRes.status === 429 ? 'rate_limited' : 'upstream_error');
            if (openaiRes.status === 401) {
                return NextResponse.json({ error: 'Invalid OpenAI API key' }, { status: 503 });
            }
            if (openaiRes.status === 429) {
                return NextResponse.json({ error: 'Rate limit exceeded. Please try again in a moment.' }, { status: 429 });
            }
            return NextResponse.json({ error: 'AI service temporarily unavailable' }, { status: 502 });
        }

        const openaiData = await openaiRes.json();
        const content = openaiData.choices?.[0]?.message?.content;

        if (!content) {
            recordReceiptScan('upstream_error');
            return NextResponse.json({ error: 'Empty response from AI' }, { status: 502 });
        }

        // Parse JSON from response (strip any markdown fences if present)
        let parsed: Record<string, unknown>;
        try {
            const cleaned = content
                .replace(/```json\s*/gi, '')
                .replace(/```\s*/g, '')
                .trim();
            parsed = JSON.parse(cleaned);
        } catch {
            logger.error('Failed to parse AI response', { responseLength: content.length });
            recordReceiptScan('unparseable');
            return NextResponse.json(
                { error: 'AI returned invalid data. Please try again with a clearer image.' },
                { status: 422 }
            );
        }

        // Normalize amounts to paise (multiply by 100)
        const toPaise = (val: unknown): number => {
            const n = typeof val === 'number' ? val : parseFloat(String(val || '0'));
            return isNaN(n) ? 0 : Math.round(n * 100);
        };

        // A discount the model listed as an item is dropped: the printed total already has it.
        const items: ReceiptItem[] = Array.isArray(parsed.items)
            ? parsed.items
                .map((item: Record<string, unknown>) => ({
                    name: String(item.name || 'Unknown item'),
                    quantity: typeof item.quantity === 'number' && item.quantity > 0 ? item.quantity : 1,
                    price: toPaise(item.price),
                }))
                .filter((item: ReceiptItem) => item.price >= 0)
            : [];

        const taxes: Record<string, number> = {};
        if (parsed.taxes && typeof parsed.taxes === 'object') {
            for (const [key, val] of Object.entries(parsed.taxes as Record<string, unknown>)) {
                taxes[key] = toPaise(val);
            }
        }

        const aiNotes = typeof parsed.notes === 'string' ? parsed.notes : null;
        const currencyCode = typeof parsed.currency === 'string' ? parsed.currency.trim().toUpperCase() : '';

        const result: ReceiptScanResult = {
            merchant: typeof parsed.merchant === 'string' ? parsed.merchant : null,
            date: typeof parsed.date === 'string' ? parsed.date : null,
            items,
            subtotal: toPaise(parsed.subtotal),
            taxes,
            total: Math.max(0, toPaise(parsed.total)),
            currency: /^[A-Z]{3}$/.test(currencyCode) ? currencyCode : 'INR',
            category: typeof parsed.category === 'string' ? parsed.category : 'general',
            confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
            notes: aiNotes,
        };

        // Each item's price is already its row total, so quantities aren't multiplied in again.
        const itemSum = items.reduce((s, i) => s + i.price, 0);
        const taxTotal = Object.values(taxes).reduce((s, v) => s + v, 0);
        const computedTotal = itemSum + taxTotal;

        // No printed total read: the items and taxes are the best there is.
        if (result.total === 0 && items.length > 0) result.total = computedTotal;

        // Flag a printed total the items and taxes are far from; the printed total still stands.
        if (result.total > 0 && computedTotal > 0 && adjustmentLooksWrong(result.total - computedTotal, result.total)) {
            const money = (paise: number) => formatCurrency(paise, result.currency);
            const note = `Item prices + taxes sum to ${money(computedTotal)} but receipt total is ${money(result.total)} (${money(Math.abs(result.total - computedTotal))} difference). Using printed receipt total.`;
            result.notes = result.notes ? `${result.notes}. ${note}` : note;
        }

        recordReceiptScan('success');
        return NextResponse.json(result);
    } catch (error) {
        logger.error('Receipt scan error', { err: error });
        recordReceiptScan('error');
        return NextResponse.json(
            { error: 'Failed to process receipt. Please try again.' },
            { status: 500 }
        );
    }
}
