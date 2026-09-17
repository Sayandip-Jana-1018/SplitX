/**
 * How long a request has waited before being handled.
 *
 * The proxy stamps `x-request-start: t=<epoch ms>` on every request it
 * forwards, and handlers doing expensive work compare it with the clock: on a
 * pod whose CPU is saturated, requests queue behind each other, and work that
 * has already waited too long is refused (503) rather than making every request
 * behind it later still.
 *
 * Where the clock starts matters more than it looks (B-016). A busy Node
 * process also delays running the proxy itself, so a stamp taken there misses
 * the time a request spent in the connection backlog and behind other work on
 * the event loop — measured on the cluster, requests "waited" under a second by
 * that clock while really waiting 26 s. When the deployment says a proxy in
 * front stamps the arrival time and overwrites whatever a client sent
 * (TRUST_UPSTREAM_REQUEST_START=true, set where ingress-nginx does exactly
 * that), the proxy keeps that earlier time instead of taking its own.
 */

export const REQUEST_START_HEADER = 'x-request-start';

/** An upstream stamp older than this is a broken clock or a replayed header, not a queue. */
const MAX_UPSTREAM_AGE_MS = 60_000;
/** Clocks on different hosts disagree slightly; a stamp this far ahead is still believed. */
const MAX_UPSTREAM_SKEW_MS = 1_000;

export function requestStartValue(now = Date.now()) {
    return `t=${now}`;
}

/**
 * Reads an arrival stamp in either format a proxy in front of the app writes:
 *   t=1788000000123    milliseconds — this app's own stamp
 *   t=1788000000.123   seconds with milliseconds — nginx's $msec
 */
export function parseRequestStart(value: string | null | undefined): number | null {
    if (!value) return null;
    const milliseconds = /^t=(\d{13})$/.exec(value);
    if (milliseconds) return Number(milliseconds[1]);
    const seconds = /^t=(\d{10})\.(\d{3})$/.exec(value);
    if (seconds) return Number(seconds[1]) * 1000 + Number(seconds[2]);
    return null;
}

/** How long a settlement preview may wait before it is refused rather than planned. */
export function previewMaxQueueMs() {
    const value = Number(process.env.PREVIEW_MAX_QUEUE_MS);
    return Number.isInteger(value) && value > 0 ? value : 1_000;
}

export function trustsUpstreamRequestStart() {
    return process.env.TRUST_UPSTREAM_REQUEST_START === 'true';
}

/**
 * When the request arrived, as far as queue time is concerned: the upstream
 * stamp when it is trusted and believable, otherwise now.
 *
 * Even a forged stamp could only hurt its sender: an old one gets the request
 * shed, a current one is what the proxy would have stamped anyway.
 */
export function arrivalTime(headers: Headers, now = Date.now(), trustUpstream = trustsUpstreamRequestStart()): number {
    if (!trustUpstream) return now;
    const stamped = parseRequestStart(headers.get(REQUEST_START_HEADER));
    if (stamped === null) return now;
    const age = now - stamped;
    if (age > MAX_UPSTREAM_AGE_MS || age < -MAX_UPSTREAM_SKEW_MS) return now;
    return Math.min(stamped, now);
}

/** Milliseconds since the proxy stamped the request, or null when it wasn't stamped. */
export function queuedMs(headers: Headers, now = Date.now()): number | null {
    const match = /^t=(\d{13})$/.exec(headers.get(REQUEST_START_HEADER) ?? '');
    if (!match) return null;
    return Math.max(0, now - Number(match[1]));
}
