import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const takeAiQuota = vi.fn();
vi.mock('@/lib/aiQuota', () => ({ takeAiQuota: (...args: unknown[]) => takeAiQuota(...args) }));

const { modelJson, scanFromModel, scanReceipt } = await import('@/lib/services/receiptScan');

const fetchMock = vi.fn();
const PHOTO = 'data:image/jpeg;base64,' + 'A'.repeat(400);

/** A bill as the models read the sample on 2026-11-21: six items, GST and a service charge, ₹2,233 printed. */
const BILL = {
    merchant: 'SPICE ROUTE KITCHEN',
    date: '2026-11-14',
    items: [
        { name: 'Paneer Tikka', quantity: 1, price: 320 },
        { name: 'Butter Naan', quantity: 4, price: 240 },
        { name: 'Dal Makhani', quantity: 1, price: 280 },
        { name: 'Chicken Biryani', quantity: 2, price: 700 },
        { name: 'Fresh Lime Soda', quantity: 3, price: 270 },
        { name: 'Gulab Jamun', quantity: 2, price: 220 },
    ],
    subtotal: 2030,
    taxes: { 'Service Charge 5%': 101.5, 'CGST 2.5%': 50.75, 'SGST 2.5%': 50.75, 'Round Off': 0 },
    total: 2233,
    currency: 'INR',
    category: 'food',
    confidence: 0.99,
    notes: null,
};

const gemini = (body: unknown) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: typeof body === 'string' ? body : JSON.stringify(body) }] } }] }), { status: 200 });
const modelOf = (call: unknown[]) => /models\/([^:]+):/.exec(String(call[0]))?.[1];

beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    takeAiQuota.mockResolvedValue({ ok: true });
});

afterEach(() => {
    vi.resetAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe('scanFromModel', () => {
    it('turns rupees into paise, keeps the printed total, and drops a charge of nothing', () => {
        const scan = scanFromModel(BILL);
        expect(scan.total).toBe(223_300);
        expect(scan.subtotal).toBe(203_000);
        expect(scan.items).toHaveLength(6);
        expect(scan.items[1]).toEqual({ name: 'Butter Naan', quantity: 4, price: 24_000 });
        expect(scan.taxes).toEqual({ 'Service Charge 5%': 10_150, 'CGST 2.5%': 5_075, 'SGST 2.5%': 5_075 });
        expect(scan.notes).toBeNull();
    });

    it('says so when the items and taxes are far from the printed total, and keeps the printed one', () => {
        const scan = scanFromModel({ ...BILL, total: 3000 });
        expect(scan.total).toBe(300_000);
        expect(scan.notes).toMatch(/receipt total is/);
    });

    it('adds up the items when no total could be read', () => {
        const scan = scanFromModel({ ...BILL, total: 0, taxes: {} });
        expect(scan.total).toBe(203_000);
    });

    it('trusts nothing it is handed: odd items, dates, currencies and confidences', () => {
        const scan = scanFromModel({ items: [null, 'x', { name: '', price: '45.5' }], date: '14/11/2026', currency: 'rupees', confidence: 7, merchant: '  ' });
        expect(scan.items).toEqual([{ name: 'Unknown item', quantity: 1, price: 4_550 }]);
        expect(scan.date).toBeNull();
        expect(scan.currency).toBe('INR');
        expect(scan.confidence).toBe(1);
        expect(scan.merchant).toBeNull();
    });
});

describe('modelJson', () => {
    it('reads JSON in code fences, and refuses anything that is not an object', () => {
        expect(modelJson('```json\n{"total": 5}\n```')).toEqual({ total: 5 });
        expect(modelJson('[1, 2]')).toBeNull();
        expect(modelJson('the total is 5')).toBeNull();
    });
});

describe('scanReceipt', () => {
    it('reads the bill with the quick model first, sending the photo inline', async () => {
        fetchMock.mockResolvedValue(gemini(BILL));

        const outcome = await scanReceipt('user-1', PHOTO);

        expect(outcome).toMatchObject({ ok: true, scan: { total: 223_300 } });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(modelOf(fetchMock.mock.calls[0])).toBe('gemini-3.5-flash-lite');
        const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(sent.contents[0].parts[0]).toEqual({ inlineData: { mimeType: 'image/jpeg', data: 'A'.repeat(400) } });
        expect(sent.generationConfig.responseMimeType).toBe('application/json');
        expect(takeAiQuota).toHaveBeenCalledWith('receipt', 'user-1');
    });

    it('asks the careful model when the quick one finds no total', async () => {
        fetchMock.mockResolvedValueOnce(gemini({ ...BILL, total: 0, items: [] })).mockResolvedValueOnce(gemini(BILL));

        const outcome = await scanReceipt('user-1', PHOTO);

        expect(outcome).toMatchObject({ ok: true, scan: { total: 223_300 } });
        expect(fetchMock.mock.calls.map(modelOf)).toEqual(['gemini-3.5-flash-lite', 'gemini-3.6-flash']);
    });

    it('asks the careful model when the quick one is busy', async () => {
        fetchMock.mockResolvedValueOnce(new Response('{}', { status: 503 })).mockResolvedValueOnce(gemini(BILL));
        expect(await scanReceipt('user-1', PHOTO)).toMatchObject({ ok: true });
    });

    it('says the bill could not be read when neither model finds a total', async () => {
        fetchMock.mockResolvedValue(gemini('not json'));
        expect(await scanReceipt('user-1', PHOTO)).toMatchObject({ ok: false, status: 422, code: 'unreadable' });
    });

    it('says busy, with a time to try again, when both models are busy', async () => {
        fetchMock.mockResolvedValue(new Response('{}', { status: 429 }));
        expect(await scanReceipt('user-1', PHOTO)).toMatchObject({ ok: false, status: 503, code: 'busy', retryAfterSeconds: 5 });
    });

    it('refuses what is not a photo, or too large, before spending the allowance', async () => {
        expect(await scanReceipt('user-1', 'data:image/gif;base64,AAAA')).toMatchObject({ ok: false, status: 400, code: 'invalid_image' });
        expect(await scanReceipt('user-1', 'data:image/jpeg;base64,' + 'A'.repeat(4_000_000))).toMatchObject({ ok: false, status: 413 });
        expect(takeAiQuota).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('stops at the allowance, pointing to on-device scanning', async () => {
        takeAiQuota.mockResolvedValue({ ok: false, status: 429, error: 'You’ve used today’s AI scans.', retryAfterSeconds: 3600 });
        expect(await scanReceipt('user-1', PHOTO)).toMatchObject({ ok: false, status: 429, code: 'ai_limit', retryAfterSeconds: 3600, error: expect.stringMatching(/On-device/) });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not call an OpenAI account out of credit busy (the scan that failed on 11-13)', async () => {
        vi.stubEnv('GEMINI_API_KEY', '');
        vi.stubEnv('OPENAI_API_KEY', 'sk-test');
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: 'insufficient_quota' } }), { status: 429 }));

        const outcome = await scanReceipt('user-1', PHOTO);

        expect(outcome).toMatchObject({ ok: false, status: 502, code: 'ai_unavailable', error: expect.stringMatching(/On-device scanning still works/) });
        expect(String(fetchMock.mock.calls[0][0])).toContain('api.openai.com');
    });

    it('says AI scanning is not set up when there is no key at all', async () => {
        vi.stubEnv('GEMINI_API_KEY', '');
        expect(await scanReceipt('user-1', PHOTO)).toMatchObject({ ok: false, status: 503, code: 'ai_unavailable' });
    });
});
