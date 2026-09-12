/** Builds a JSON request the way the browser sends it to a route handler. */
export function jsonRequest(url: string, body: unknown, init: RequestInit = {}) {
    return new Request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
        body: JSON.stringify(body),
        ...init,
    });
}

/** Valid-format CUIDs for schemas that require them. */
export const ids = {
    trip: 'ctrip0000000001',
    alice: 'cuseralice00001',
    bob: 'cuserbob0000001',
    carol: 'cusercarol00001',
    stranger: 'cuserstranger01',
    group: 'cgroup000000001',
} as const;
