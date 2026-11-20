/**
 * Reading a bill from a photo: the website's scan page (POST /api/receipt-scan) and the phone
 * (POST /api/v1/receipts/scan) both come here.
 *
 * Gemini reads it (GEMINI_API_KEY), with OpenAI's vision model as the fallback when only
 * OPENAI_API_KEY is set. On 2026-11-21 the OpenAI account had run out of credit, which the scan
 * page called a "rate limit" (the user's real bill failed on 11-13). On a sample bill every
 * Gemini model read all six items, the GST and the printed total right: the lite models in 2.6
 * to 3.8 s, the bigger Flash models in 36 to 45 s. So a scan asks the quick model first
 * (GEMINI_RECEIPT_MODEL, by default `gemini-3.5-flash-lite`), and the bigger one
 * (GEMINI_RECEIPT_FALLBACK_MODEL) only when the quick answer can't be used.
 *
 * Every amount comes back in paise. The printed total is the truth; when the items and taxes are
 * far from it, a note says so (receiptSplit.ts adjustmentLooksWrong).
 */
import { takeAiQuota } from '@/lib/aiQuota';
import { RECEIPT_IMAGE_MAX_CHARS, type ReceiptScan } from '@/lib/contract/v1';
import { generateWithGemini } from '@/lib/gemini';
import { logger } from '@/lib/logger';
import { adjustmentLooksWrong } from '@/lib/receiptSplit';
import { formatCurrency } from '@/lib/utils';

const QUICK_MODEL = 'gemini-3.5-flash-lite';
const CAREFUL_MODEL = 'gemini-3.6-flash';

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

const ASK = 'Parse this receipt. IMPORTANT: Read the final Payment/Grand Total amount directly from the receipt — do NOT compute it from items. Return structured JSON:';

const IMAGE_DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

export type ScanOutcome =
    | { ok: true; scan: ReceiptScan }
    | { ok: false; status: number; code: string; error: string; retryAfterSeconds?: number };

const failure = (status: number, code: string, error: string, retryAfterSeconds?: number): ScanOutcome => ({ ok: false, status, code, error, retryAfterSeconds });

/** The model's JSON, without the code fences some models wrap it in; null when it isn't a JSON object. */
export function modelJson(text: string): Record<string, unknown> | null {
    try {
        const parsed: unknown = JSON.parse(
            text
                .replace(/```json\s*/gi, '')
                .replace(/```\s*/g, '')
                .trim(),
        );
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

function toPaise(value: unknown): number {
    const n = typeof value === 'number' ? value : Number.parseFloat(String(value || '0'));
    return Number.isNaN(n) ? 0 : Math.round(n * 100);
}

/** What the model read, in paise and checked: the printed total stands, and a total far from the items and taxes is noted. */
export function scanFromModel(parsed: Record<string, unknown>): ReceiptScan {
    // A discount the model listed as an item is dropped: the printed total already has it.
    const items = Array.isArray(parsed.items)
        ? parsed.items
              .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
              .map((item) => ({
                  name: String(item.name || 'Unknown item'),
                  quantity: typeof item.quantity === 'number' && item.quantity > 0 ? item.quantity : 1,
                  price: toPaise(item.price),
              }))
              .filter((item) => item.price >= 0)
        : [];

    const taxes: Record<string, number> = {};
    if (parsed.taxes && typeof parsed.taxes === 'object') {
        for (const [key, value] of Object.entries(parsed.taxes as Record<string, unknown>)) {
            const paise = toPaise(value);
            // A line of nothing ("Round Off 0.00") is no charge.
            if (paise !== 0) taxes[key] = paise;
        }
    }

    const currencyCode = typeof parsed.currency === 'string' ? parsed.currency.trim().toUpperCase() : '';
    const scan: ReceiptScan = {
        merchant: typeof parsed.merchant === 'string' && parsed.merchant.trim() ? parsed.merchant.trim() : null,
        date: typeof parsed.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : null,
        items,
        subtotal: toPaise(parsed.subtotal),
        taxes,
        total: Math.max(0, toPaise(parsed.total)),
        currency: /^[A-Z]{3}$/.test(currencyCode) ? currencyCode : 'INR',
        category: typeof parsed.category === 'string' ? parsed.category : 'general',
        confidence: typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5,
        notes: typeof parsed.notes === 'string' && parsed.notes.trim() ? parsed.notes.trim() : null,
    };

    // Each item's price is already its row total, so quantities aren't multiplied in again.
    const itemSum = items.reduce((sum, item) => sum + item.price, 0);
    const taxTotal = Object.values(taxes).reduce((sum, value) => sum + value, 0);
    const computedTotal = itemSum + taxTotal;

    // No printed total read: the items and taxes are the best there is.
    if (scan.total === 0 && items.length > 0) scan.total = computedTotal;

    // Flag a printed total the items and taxes are far from; the printed total still stands.
    if (scan.total > 0 && computedTotal > 0 && adjustmentLooksWrong(scan.total - computedTotal, scan.total)) {
        const money = (paise: number) => formatCurrency(paise, scan.currency);
        const note = `Item prices + taxes sum to ${money(computedTotal)} but receipt total is ${money(scan.total)} (${money(Math.abs(scan.total - computedTotal))} difference). Using printed receipt total.`;
        scan.notes = scan.notes ? `${scan.notes}. ${note}` : note;
    }
    return scan;
}

/** A scan worth showing: something to add up. */
const usable = (scan: ReceiptScan | null): scan is ReceiptScan => Boolean(scan && scan.total > 0);

type Read = { ok: true; scan: ReceiptScan | null } | { ok: false; reason: 'timeout' | 'busy' | 'unavailable' };

async function readWithGemini(image: { mimeType: string; data: string }, model: string, timeoutMs: number): Promise<Read> {
    const answer = await generateWithGemini({ system: SYSTEM_PROMPT, user: ASK, image, model, maxOutputTokens: 4096, temperature: 0.1, json: true, thinking: 'low', timeoutMs });
    if (answer.ok) {
        const parsed = modelJson(answer.text);
        return { ok: true, scan: parsed ? scanFromModel(parsed) : null };
    }
    if (answer.reason === 'empty') return { ok: true, scan: null };
    logger.warn('Gemini receipt scan failed', { model, reason: answer.reason, status: answer.status });
    if (answer.reason === 'timeout') return { ok: false, reason: 'timeout' };
    return { ok: false, reason: answer.reason === 'busy' ? 'busy' : 'unavailable' };
}

async function readWithOpenAi(dataUrl: string, apiKey: string): Promise<Read> {
    let res: Response;
    try {
        res = await fetch('https://api.openai.com/v1/chat/completions', {
            signal: AbortSignal.timeout(45_000),
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: [{ type: 'text', text: ASK }, { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } }] },
                ],
                max_tokens: 2000,
                temperature: 0.1,
            }),
        });
    } catch (error) {
        const name = (error as { name?: string })?.name;
        return { ok: false, reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'unavailable' };
    }
    if (!res.ok) {
        // An account out of credit answers 429 too (insufficient_quota): that isn't "busy", and won't pass.
        const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
        const code = body?.error?.code;
        logger.error('OpenAI receipt scan failed', { status: res.status, code });
        return { ok: false, reason: res.status === 429 && code !== 'insufficient_quota' ? 'busy' : 'unavailable' };
    }
    const data = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string } }[] } | null;
    const content = data?.choices?.[0]?.message?.content;
    const parsed = content ? modelJson(content) : null;
    return { ok: true, scan: parsed ? scanFromModel(parsed) : null };
}

/** Reads the quick model, and the careful one when the quick read failed or found nothing to add up. */
async function readWithGeminiTwice(image: { mimeType: string; data: string }): Promise<Read> {
    const quick = await readWithGemini(image, process.env.GEMINI_RECEIPT_MODEL || QUICK_MODEL, 30_000);
    if (quick.ok && usable(quick.scan)) return quick;
    const careful = await readWithGemini(image, process.env.GEMINI_RECEIPT_FALLBACK_MODEL || CAREFUL_MODEL, 45_000);
    if (careful.ok && usable(careful.scan)) return careful;
    // Neither found a total: say the photo was read but nothing could be found, if either read it at all.
    if (quick.ok) return quick;
    return careful.ok ? careful : quick;
}

/** Reads the bill in a photo (a JPEG, PNG or WebP data URL) for this person, within their AI allowance. */
export async function scanReceipt(userId: string, dataUrl: string): Promise<ScanOutcome> {
    if (dataUrl.length > RECEIPT_IMAGE_MAX_CHARS) return failure(413, 'too_large', 'That photo is too large to scan. Try again from the camera, or use on-device mode.');
    const match = IMAGE_DATA_URL.exec(dataUrl);
    if (!match) return failure(400, 'invalid_image', 'Send a JPEG, PNG or WebP photo of the receipt.');

    const gemini = Boolean(process.env.GEMINI_API_KEY);
    const openAiKey = process.env.OPENAI_API_KEY;
    if (!gemini && !openAiKey) return failure(503, 'ai_unavailable', 'AI scanning isn’t set up here. On-device scanning still works.');

    const quota = await takeAiQuota('receipt', userId);
    if (!quota.ok) return failure(quota.status, 'ai_limit', `${quota.error} On-device scanning still works.`, quota.retryAfterSeconds);

    const read = gemini ? await readWithGeminiTwice({ mimeType: match[1], data: match[2] }) : await readWithOpenAi(dataUrl, openAiKey as string);

    if (!read.ok) {
        if (read.reason === 'timeout') return failure(504, 'timeout', 'The AI scan took too long. Try again, or use on-device mode.');
        if (read.reason === 'busy') return failure(503, 'busy', 'The AI is busy right now. Try again in a moment, or use on-device mode.', 5);
        return failure(502, 'ai_unavailable', 'AI scanning isn’t available right now. On-device scanning still works.');
    }
    if (!usable(read.scan)) return failure(422, 'unreadable', 'Couldn’t find a total on that bill. Try a sharper, flatter photo with the total in it.');
    return { ok: true, scan: read.scan };
}
