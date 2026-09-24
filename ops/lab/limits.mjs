/**
 * What the traffic lab may be asked to do (D-097). Pure, so the unit tests
 * check every refusal.
 *
 * A run is at most 30 plans a second for at most 180 seconds. Measured on the
 * cluster (D-051), a pod settles at about 4 plans a second at the
 * autoscaler's target, so 30 a second asks for about 8 pods: enough to watch
 * the autoscaler add pods and a node, and far below what the rate limiter
 * allows one network (D-045). The target is the lab's own configuration,
 * never part of a request.
 */

export const LIMITS = {
    rate: { min: 1, max: 30, default: 20 },
    seconds: { min: 30, max: 180, default: 120 },
};

/**
 * A run request's parameters, or a RangeError saying what is wrong.
 * @param {unknown} body
 */
export function parseRun(body) {
    const request = body ?? {};
    if (typeof request !== 'object' || Array.isArray(request)) throw new RangeError('send a JSON object: { "rate": 20, "seconds": 120 }');
    const unknown = Object.keys(request).filter((key) => !['rate', 'seconds'].includes(key));
    if (unknown.length) throw new RangeError('"' + unknown[0] + '" is not a setting: the lab has a fixed target, and only rate and seconds can be chosen');
    const pick = (name) => {
        const { min, max, default: fallback } = LIMITS[name];
        const value = request[name] ?? fallback;
        if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(name + ' must be a whole number from ' + min + ' to ' + max);
        return value;
    };
    return { rate: pick('rate'), seconds: pick('seconds') };
}

/**
 * What k6 reported at the end of a run (its handleSummary data), in the lab's
 * own words: how many plans were asked for, served, refused on purpose, or
 * failed, and how long the slowest 5% took.
 */
export function summariseK6(data) {
    const count = (name) => data?.metrics?.[name]?.values?.count ?? 0;
    const p95 = data?.metrics?.http_req_duration?.values?.['p(95)'];
    return {
        requests: count('http_reqs'),
        served: count('preview_ok'),
        // 429 and 503 are the app protecting itself (D-045, D-046), not errors.
        refused: count('preview_rate_limited') + count('preview_shed'),
        failed: count('preview_other'),
        p95Ms: Number.isFinite(p95) ? Math.round(p95) : null,
    };
}
