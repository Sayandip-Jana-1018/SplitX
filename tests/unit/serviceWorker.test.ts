import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

/*
 * Runs public/sw.js as the browser would, against an in-memory Cache Storage,
 * to check what it keeps: its offline page and nothing else.
 */

type Handler = (event: Record<string, unknown>) => void;

function loadWorker(existingCaches: string[], network: (request: Request) => Promise<Response>) {
    const handlers = new Map<string, Handler>();
    const stores = new Map<string, Map<string, Response>>(existingCaches.map((name) => [name, new Map()]));
    const caches = {
        keys: async () => [...stores.keys()],
        delete: async (name: string) => stores.delete(name),
        open: async (name: string) => {
            if (!stores.has(name)) stores.set(name, new Map());
            const store = stores.get(name)!;
            return { add: async (request: Request) => { store.set(new URL(request.url).pathname, new Response('offline page')); } };
        },
        match: async (url: string) => {
            for (const store of stores.values()) if (store.has(url)) return store.get(url)!.clone();
            return undefined;
        },
    };
    const self = {
        location: { origin: 'https://splitx.example' },
        addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
        skipWaiting: vi.fn(async () => undefined),
        clients: { claim: vi.fn(async () => undefined) },
    };
    const RequestWithBase = class extends Request {
        constructor(input: string, init?: RequestInit) {
            super(new URL(input, 'https://splitx.example'), init);
        }
    };

    new Function('self', 'caches', 'fetch', 'Request', 'Response', readFileSync('public/sw.js', 'utf8'))(
        self, caches, network, RequestWithBase, Response
    );

    async function dispatch(type: string, extra: Record<string, unknown> = {}) {
        let waited: Promise<unknown> = Promise.resolve();
        let responded: Promise<Response> | null = null;
        handlers.get(type)!({
            ...extra,
            waitUntil: (promise: Promise<unknown>) => { waited = promise; },
            respondWith: (promise: Promise<Response>) => { responded = promise; },
        });
        await waited;
        return responded as Promise<Response> | null;
    }

    return { stores, self, dispatch };
}

const offline = () => Promise.reject(new TypeError('Failed to fetch'));

describe('public/sw.js', () => {
    it('removes every cache an earlier worker left, including a next-pwa API cache', async () => {
        const worker = loadWorker(['apis', 'pages', 'pages-rsc', 'others', 'workbox-precache-v2-https://splitx.example/'], offline);

        await worker.dispatch('install');
        await worker.dispatch('activate');

        expect([...worker.stores.keys()]).toEqual(['splitx-offline-v1']);
        expect(worker.self.skipWaiting).toHaveBeenCalled();
        expect(worker.self.clients.claim).toHaveBeenCalled();
    });

    it('never answers an API call: it goes to the network untouched', async () => {
        const worker = loadWorker([], offline);

        const handled = await worker.dispatch('fetch', { request: { mode: 'cors', url: 'https://splitx.example/api/transactions' } });

        expect(handled).toBeNull();
    });

    it('loads pages from the network while online', async () => {
        const worker = loadWorker([], async () => new Response('dashboard'));
        await worker.dispatch('install');

        const response = await worker.dispatch('fetch', { request: { mode: 'navigate', url: 'https://splitx.example/dashboard' } });

        expect(await response!.text()).toBe('dashboard');
    });

    it('shows the offline page, and only that, when the network is gone', async () => {
        const worker = loadWorker([], offline);
        await worker.dispatch('install');

        const response = await worker.dispatch('fetch', { request: { mode: 'navigate', url: 'https://splitx.example/dashboard' } });

        expect(await response!.text()).toBe('offline page');
    });
});
