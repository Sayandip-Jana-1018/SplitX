import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { deduplicateTranscript } from '@/lib/deduplicateTranscript';

/**
 * POST /api/ai/parse-voice — Parse voice transcript into structured transaction data.
 * Uses Gemini to extract amount, title, split type, members, and custom amounts
 * from a natural language voice input.
 */

interface ParsedVoiceResult {
    amount: number;
    title: string;
    splitType: 'equal' | 'custom';
    members: { name: string; amount?: number; confidence: number }[];
    payer?: string;
    confidence: number;
    rawTranscript: string;
}

export async function POST(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { transcript, memberNames, groupName } = (await req.json()) as {
            transcript: string;
            memberNames: string[];
            groupName: string;
        };

        if (!transcript?.trim()) {
            return NextResponse.json({ error: 'No transcript provided' }, { status: 400 });
        }

        if (!memberNames || memberNames.length === 0) {
            return NextResponse.json({ error: 'No group members provided' }, { status: 400 });
        }

        // Clean transcript: deduplicate repeated words/phrases from mobile speech engines
        const cleanedTranscript = deduplicateTranscript(transcript.trim());

        if (!cleanedTranscript) {
            return NextResponse.json({ error: 'No usable speech detected' }, { status: 400 });
        }

        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) {
            // Local fallback: simple regex-based parsing
            const result = parseTranscriptLocally(cleanedTranscript, memberNames);
            return NextResponse.json(result);
        }

        // Use Gemini for intelligent parsing
        const result = await parseWithGemini(apiKey, cleanedTranscript, memberNames, groupName);
        return NextResponse.json(result);
    } catch (error) {
        console.error('Voice parse error:', error);
        return NextResponse.json({ error: 'Failed to parse voice input' }, { status: 500 });
    }
}

async function parseWithGemini(
    apiKey: string,
    transcript: string,
    memberNames: string[],
    groupName: string
): Promise<ParsedVoiceResult> {
    const systemPrompt = `You are a precise transaction parser for the SplitX app. Parse the user's voice transcript into structured expense data.

RULES:
1. Extract the amount (a number in the transcript). If multiple numbers exist, the first/largest is likely the total.
2. Extract a short title/description for the expense (2-4 words max, like "Dinner", "Cab fare", "Groceries"). If the user says "as biryani" or "for pizza" etc, use that as the title.
3. CATEGORY DETECTION — match the expense to one of these preset categories:
   - "general" (default), "food" (any food/drink/restaurant/meal), "transport" (cab/uber/auto/bus/train),
   - "shopping" (clothes/amazon/mall), "tickets" (movies/events/entry), "fuel" (petrol/diesel/gas),
   - "medical" (doctor/pharmacy/hospital), "entertainment" (games/movies/fun), "other"
   If the user mentions a food item (biryani, pizza, coffee, lunch, dinner, snacks), set category="food".
   If the title clearly maps to a preset, use that preset key. Otherwise use "general".
4. Determine split type: "equal" if they say split/divide equally or just mention names, "custom" if they specify different amounts.
5. Match member names ONLY against this provided list (case-insensitive, fuzzy match OK): [${memberNames.join(', ')}]
6. If a mentioned name does NOT match any member in the group, add it to "warnings" array with a message like "Could not find 'XYZ' in this group".
7. If "custom" split: extract per-person amounts. If one person's amount isn't specified, calculate it as remainder.
8. If no members mentioned, assume ALL members are included with equal split.
9. Currency is always INR (₹). Amounts are in rupees.
10. Set confidence 0.0-1.0 for each field based on how clear the transcript was.

EXAMPLES:
- "split 500 among Sneh and Sayandip" → amount:500, equal split, members:[Sneh, Sayandip], category:"general"
- "split 24 as biryani between Sneh and Ankan" → amount:24, title:"Biryani", category:"food", members:[Sneh, Ankan], equal
- "dinner 800 rupees" → amount:800, title:"Dinner", category:"food", all members, equal
- "cab 250 paid by me for Sneh and Ankan" → amount:250, title:"Cab", category:"transport", members:[Sneh, Ankan], equal, payer:"me"
- "264 between Sneh and Ankit as Biryani paid by Ankit" → amount:264, title:"Biryani", category:"food", members:[Sneh, Ankit], equal, payer:"Ankit"
- "divide 423 custom between Sayandip 234 and Ankit rest" → amount:423, custom, Sayandip:234, Ankit:189
- "split 120 between Rahul and Sneh" (Rahul not in group) → amount:120, members:[Sneh], warnings:["Could not find 'Rahul' in this group"]

RESPOND WITH ONLY VALID JSON (no markdown, no explanation):
{
  "amount": <number>,
  "title": "<string>",
  "category": "<preset key or custom string>",
  "splitType": "equal" | "custom",
  "members": [{"name": "<matched name>", "amount": <number or null>, "confidence": <0-1>}],
  "payer": "<name of who paid, or null if not mentioned>",
  "warnings": ["<string>"],
  "confidence": <0-1>,
  "rawTranscript": "<original transcript>"
}`;

    try {
        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: `${systemPrompt}\n\nGroup: "${groupName}"\nMembers: ${memberNames.join(', ')}\n\nTranscript: "${transcript}"` }] }],
                    generationConfig: {
                        maxOutputTokens: 512,
                        temperature: 0.1,
                        responseMimeType: 'application/json',
                    },
                }),
            }
        );

        if (!res.ok) {
            console.error('Gemini parse error:', res.status);
            return parseTranscriptLocally(transcript, memberNames);
        }

        const data = await res.json();
        const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!raw) {
            return parseTranscriptLocally(transcript, memberNames);
        }

        // Parse the JSON response, handle potential markdown wrapping
        const jsonStr = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const parsed = JSON.parse(jsonStr) as ParsedVoiceResult;

        // Validate and sanitize
        parsed.rawTranscript = transcript;
        parsed.amount = Math.max(0, Number(parsed.amount) || 0);
        parsed.confidence = Math.min(1, Math.max(0, Number(parsed.confidence) || 0.5));
        parsed.splitType = parsed.splitType === 'custom' ? 'custom' : 'equal';
        parsed.title = (parsed.title || '').slice(0, 100);

        // Extract and fuzzy-match payer name
        if (parsed.payer) {
            const matchedPayer = fuzzyMatchName(parsed.payer, memberNames);
            parsed.payer = matchedPayer || parsed.payer;
        }

        // Validate member names against the provided list
        if (parsed.members && Array.isArray(parsed.members)) {
            parsed.members = parsed.members
                .filter(m => m && m.name)
                .map(m => ({
                    ...m,
                    name: fuzzyMatchName(m.name, memberNames) || m.name,
                    confidence: Math.min(1, Math.max(0, Number(m.confidence) || 0.5)),
                }));
        } else {
            // Default to all members with equal split
            parsed.members = memberNames.map(name => ({ name, confidence: 0.7 }));
        }

        // Calculate remainder for custom splits
        if (parsed.splitType === 'custom' && parsed.amount > 0) {
            const specified = parsed.members
                .filter(m => m.amount && m.amount > 0)
                .reduce((sum, m) => sum + (m.amount || 0), 0);
            const unspecified = parsed.members.filter(m => !m.amount || m.amount <= 0);
            if (unspecified.length > 0 && specified < parsed.amount) {
                const remainder = parsed.amount - specified;
                const perUnspecified = Math.round((remainder / unspecified.length) * 100) / 100;
                for (const m of unspecified) {
                    m.amount = perUnspecified;
                }
            }
        }

        return parsed;
    } catch (error) {
        console.error('Gemini parse failed, using local fallback:', error);
        return parseTranscriptLocally(transcript, memberNames);
    }
}

/** Fuzzy match a name against a list of known names */
function fuzzyMatchName(input: string, candidates: string[]): string | null {
    const lower = input.toLowerCase().trim();
    // Exact match
    const exact = candidates.find(c => c.toLowerCase() === lower);
    if (exact) return exact;
    // Starts with
    const startsWith = candidates.find(c => c.toLowerCase().startsWith(lower));
    if (startsWith) return startsWith;
    // Contains
    const contains = candidates.find(c => c.toLowerCase().includes(lower));
    if (contains) return contains;
    // First name match
    const firstName = candidates.find(c => c.toLowerCase().split(' ')[0] === lower);
    if (firstName) return firstName;
    // Levenshtein-like: check if edit distance is small enough
    for (const c of candidates) {
        if (levenshteinDistance(lower, c.toLowerCase()) <= 2) return c;
    }
    return null;
}

function levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];
    for (let i = 0; i <= a.length; i++) matrix[i] = [i];
    for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
            );
        }
    }
    return matrix[a.length][b.length];
}

/** Simple local fallback parser (no AI) */
function parseTranscriptLocally(transcript: string, memberNames: string[]): ParsedVoiceResult {
    const lower = transcript.toLowerCase();
    const words = lower.split(/\s+/);

    // Extract amount — find the first number
    let amount = 0;
    const amountMatch = transcript.match(/(\d+(?:\.\d{1,2})?)/);
    if (amountMatch) {
        amount = parseFloat(amountMatch[1]);
    }

    // Extract mentioned member names
    const mentionedMembers: string[] = [];
    for (const name of memberNames) {
        const nameLower = name.toLowerCase();
        const firstName = nameLower.split(' ')[0];
        if (lower.includes(nameLower) || lower.includes(firstName)) {
            mentionedMembers.push(name);
        }
    }

    // Determine split type
    const isCustom = lower.includes('custom') || lower.includes('unequal') ||
        lower.includes('different') || /\d+\s+to\s+\w/.test(lower);

    // Extract title — heuristic: words that aren't numbers or member names
    const titleWords = words.filter(w =>
        !w.match(/^\d/) && !w.match(/^(split|divide|among|between|and|the|for|rs|rupees|rupee|custom|equally|equal|rest|with)$/) &&
        !memberNames.some(n => n.toLowerCase().startsWith(w))
    );
    const title = titleWords.slice(0, 3).join(' ').replace(/^./, c => c.toUpperCase()) || 'Expense';

    return {
        amount,
        title,
        splitType: isCustom ? 'custom' : 'equal',
        members: (mentionedMembers.length > 0 ? mentionedMembers : memberNames).map(name => ({
            name,
            confidence: mentionedMembers.includes(name) ? 0.8 : 0.4,
        })),
        confidence: amount > 0 ? 0.7 : 0.3,
        rawTranscript: transcript,
    };
}
