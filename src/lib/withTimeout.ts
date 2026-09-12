/** Resolves like `promise`, or rejects if it hasn't settled within `ms`. The timer never outlives the race. */
export async function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}
