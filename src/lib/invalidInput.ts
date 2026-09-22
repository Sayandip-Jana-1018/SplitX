import { NextResponse } from 'next/server';
import type { z } from 'zod';

/**
 * A 400 for input that failed its schema: one sentence naming the field, the
 * way the money routes already answer ("Invalid amount: …"). Never the
 * validator's own objects (codes, paths, expected types): the pages can only
 * show text, and those objects describe the code to anyone who sends junk.
 */
export function invalidInput(error: z.ZodError) {
    const [issue] = error.issues;
    const field = issue?.path.join('.');
    return NextResponse.json(
        { error: issue ? `Invalid ${field || 'request'}: ${issue.message}` : 'Invalid request' },
        { status: 400 },
    );
}
