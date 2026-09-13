/**
 * How long a request has waited in this process.
 *
 * The proxy stamps `x-request-start: t=<epoch ms>` the moment a request
 * arrives, replacing anything a client sent. Handlers doing expensive work
 * compare it with the clock: on a pod whose CPU is saturated, requests queue
 * behind each other on the event loop, and work that has already waited too
 * long is refused (503) rather than making every request behind it later still.
 */

export const REQUEST_START_HEADER = 'x-request-start';

export function requestStartValue(now = Date.now()) {
    return `t=${now}`;
}

/** Milliseconds since the proxy stamped the request, or null when it wasn't stamped. */
export function queuedMs(headers: Headers, now = Date.now()): number | null {
    const match = /^t=(\d{13})$/.exec(headers.get(REQUEST_START_HEADER) ?? '');
    if (!match) return null;
    return Math.max(0, now - Number(match[1]));
}
