export class BodyTooLargeError extends Error {
    constructor(readonly limitBytes: number) {
        super(`Request body is larger than ${limitBytes} bytes`);
        this.name = 'BodyTooLargeError';
    }
}

export class InvalidJsonError extends Error {
    constructor() {
        super('Request body is not valid JSON');
        this.name = 'InvalidJsonError';
    }
}

/**
 * Parses a JSON request body, refusing to buffer more than `limitBytes`.
 * `request.json()` would read any amount into memory before validation runs;
 * this stops at the limit whether or not the client declared a Content-Length.
 */
export async function readJsonBody(request: Request, limitBytes: number): Promise<unknown> {
    const declared = request.headers.get('content-length');
    if (declared !== null && Number(declared) > limitBytes) throw new BodyTooLargeError(limitBytes);
    if (!request.body) throw new InvalidJsonError();

    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > limitBytes) {
            await reader.cancel();
            throw new BodyTooLargeError(limitBytes);
        }
        chunks.push(value);
    }

    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
        throw new InvalidJsonError();
    }
}
