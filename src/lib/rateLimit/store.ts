import IORedis from 'ioredis';
import { Redis as UpstashRedis } from '@upstash/redis';

/**
 * Sliding-window counter, evaluated atomically inside Redis.
 *
 * The count for "now" is this window's hits plus last window's hits weighted by
 * how much of last window still overlaps the sliding interval. Running as one
 * script means concurrent requests from many pods can't both read "under the
 * limit" and both get through.
 *
 * The same script runs over TCP (ioredis — Kubernetes, Docker) and over
 * Upstash's REST API (Vercel), so limits behave identically everywhere.
 *
 * KEYS[1] current window, KEYS[2] previous window
 * ARGV[1] limit, ARGV[2] window ms, ARGV[3] now ms
 * Returns { allowed (1/0), count, ms until the current window ends }.
 */
const SLIDING_WINDOW_SCRIPT = `
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local previous = tonumber(redis.call('GET', KEYS[2]) or '0')
local elapsed = now % window
-- Rounded up: the approximation must never admit more than the limit.
local weighted = math.ceil(previous * (window - elapsed) / window)
if weighted + current >= limit then
  return {0, weighted + current, window - elapsed}
end
current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], window * 2)
end
return {1, weighted + current, window - elapsed}
`;

export interface HitResult {
    allowed: boolean;
    count: number;
    resetMs: number;
}

export interface RateLimitStore {
    readonly backend: 'redis' | 'upstash';
    hit(key: string, limit: number, windowMs: number, now: number): Promise<HitResult>;
    /** Prepare the backend at startup so the first real request doesn't pay for it. */
    warm(): Promise<void>;
    close(): Promise<void>;
}

/** Both windows share a hash tag so they always land on the same Redis Cluster slot. */
export function windowKeys(key: string, windowMs: number, now: number): [string, string] {
    const index = Math.floor(now / windowMs);
    return [`rl:{${key}}:${index}`, `rl:{${key}}:${index - 1}`];
}

function parseReply(reply: unknown): HitResult {
    if (!Array.isArray(reply) || reply.length !== 3) {
        throw new Error(`Unexpected rate limit reply: ${JSON.stringify(reply)}`);
    }
    const [allowed, count, resetMs] = reply.map(Number);
    return { allowed: allowed === 1, count, resetMs };
}

type ScriptedRedis = IORedis & {
    splitxSlidingWindow(current: string, previous: string, limit: number, windowMs: number, now: number): Promise<unknown>;
};

/** How long after start-up requests wait for the first Redis connection. */
const STARTUP_GRACE_MS = 5_000;

export function createRedisStore(
    url: string,
    onError: (error: Error) => void,
    { startupGraceMs = STARTUP_GRACE_MS }: { startupGraceMs?: number } = {}
): RateLimitStore {
    const client = new IORedis(url, {
        // Fail immediately while disconnected instead of queueing: the caller
        // lets requests through rather than making users wait on Redis.
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        connectTimeout: 2_000,
        commandTimeout: 500,
    }) as ScriptedRedis;
    client.on('error', onError);
    client.defineCommand('splitxSlidingWindow', { numberOfKeys: 2, lua: SLIDING_WINDOW_SCRIPT });

    // A new process can take requests before its first connection is up (half a
    // second to Redis from a container, measured). Failing fast then would let a
    // new pod's first requests through unchecked, so until the first connection
    // or the end of the grace period a request waits for it instead — still
    // bounded by the caller's timeout. After that, a lost connection fails fast.
    let everConnected = false;
    const startup = Promise.race([
        new Promise<void>((resolve) => client.once('ready', () => {
            everConnected = true;
            resolve();
        })),
        new Promise<void>((resolve) => setTimeout(resolve, startupGraceMs).unref()),
    ]);

    return {
        backend: 'redis',
        async hit(key, limit, windowMs, now) {
            if (!everConnected) await startup;
            const [current, previous] = windowKeys(key, windowMs, now);
            return parseReply(await client.splitxSlidingWindow(current, previous, limit, windowMs, now));
        },
        async warm() {},
        async close() {
            await client.quit().catch(() => client.disconnect());
        },
    };
}

export function createUpstashStore(url: string, token: string, onError: (error: Error) => void = () => {}): RateLimitStore {
    const redis = new UpstashRedis({ url, token, retry: false, enableTelemetry: false });
    const script = redis.createScript<unknown>(SLIDING_WINDOW_SCRIPT);

    return {
        backend: 'upstash',
        async hit(key, limit, windowMs, now) {
            const [current, previous] = windowKeys(key, windowMs, now);
            return parseReply(await script.exec([current, previous], [String(limit), String(windowMs), String(now)]));
        },
        async warm() {
            // Without this, a fresh instance's first request pays for the TLS
            // handshake plus an EVALSHA miss and EVAL retry, and can exceed the timeout.
            await redis.scriptLoad(SLIDING_WINDOW_SCRIPT).catch(onError);
        },
        async close() {},
    };
}
