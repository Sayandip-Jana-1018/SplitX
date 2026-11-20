/**
 * One way to call Gemini, for the chat, voice parsing and receipt scans.
 *
 * - The key travels in the `x-goog-api-key` header, never in the URL, where
 *   proxies and logs keep it.
 * - Instructions and SplitIT's own data go in `systemInstruction`; what the
 *   person typed or said is a user turn of its own. Mixed into one prompt, a
 *   message could pose as instructions.
 * - Every call has a deadline. Gemini can take a minute and more when it is
 *   busy (measured 2026-09-22, and again 2026-11-21: 44 s for one word), and
 *   a person waiting on a spinner is worse off than one told to try again.
 *
 * The model is `GEMINI_MODEL`, by default `gemini-3.6-flash`: on 2026-09-22
 * Google retired `gemini-2.0-flash`, which SplitIT used, and named this as its
 * replacement. A call can name its own model (receipt scans do).
 */

const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';

export type GeminiResult =
    | { ok: true; text: string }
    | { ok: false; reason: 'no_key' | 'timeout' | 'busy' | 'error' | 'empty'; status?: number };

export async function generateWithGemini(params: {
    system: string;
    user: string;
    /** A photo the person sent, read with their words: a receipt. */
    image?: { mimeType: string; data: string };
    model?: string;
    maxOutputTokens: number;
    temperature: number;
    json?: boolean;
    /** How much the model reasons before answering. Lower is faster. */
    thinking?: 'minimal' | 'low';
    timeoutMs: number;
}): Promise<GeminiResult> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return { ok: false, reason: 'no_key' };

    const model = params.model || process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
    const parts: Record<string, unknown>[] = [];
    if (params.image) parts.push({ inlineData: { mimeType: params.image.mimeType, data: params.image.data } });
    parts.push({ text: params.user });
    let res: Response;
    try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: params.system }] },
                contents: [{ role: 'user', parts }],
                generationConfig: {
                    maxOutputTokens: params.maxOutputTokens,
                    temperature: params.temperature,
                    ...(params.json ? { responseMimeType: 'application/json' } : {}),
                    thinkingConfig: { thinkingLevel: params.thinking ?? 'low' },
                },
            }),
            signal: AbortSignal.timeout(params.timeoutMs),
        });
    } catch (error) {
        const name = (error as { name?: string })?.name;
        return { ok: false, reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'error' };
    }

    if (!res.ok) {
        return { ok: false, reason: res.status === 429 || res.status === 503 ? 'busy' : 'error', status: res.status };
    }
    const data = await res.json().catch(() => null);
    const answer: { text?: string; thought?: boolean }[] = data?.candidates?.[0]?.content?.parts ?? [];
    const text = answer.filter((part) => !part.thought && typeof part.text === 'string').map((part) => part.text).join('').trim();
    return text ? { ok: true, text } : { ok: false, reason: 'empty' };
}
