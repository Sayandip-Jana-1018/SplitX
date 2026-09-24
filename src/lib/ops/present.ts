/**
 * How /ops words and colours what its sources report (D-098). The page only
 * presents: every rule for turning a source's state into a label or a colour
 * lives here, and is tested.
 */

export type StateTone = 'success' | 'danger' | 'warning' | 'neutral';

const TONES = new Map<string, StateTone>([
    ['success', 'success'],
    ['OK', 'success'],
    ['failure', 'danger'],
    ['error', 'danger'],
    ['ERROR', 'danger'],
    ['timed_out', 'danger'],
    ['in_progress', 'warning'],
    ['queued', 'warning'],
    ['pending', 'warning'],
    ['waiting', 'warning'],
]);

/** The colour of a GitHub or SonarQube Cloud state; one it doesn't know (skipped, cancelled, none) is neutral. */
export function toneOf(state: string | null | undefined): StateTone {
    return (state && TONES.get(state)) || 'neutral';
}

/** A state in words ("in progress", "timed out"); a deployment nobody has reported on yet says so. */
export function stateLabel(state: string | null | undefined): string {
    return state ? state.replaceAll('_', ' ') : 'no report yet';
}

/** Seconds the way a person reads them: "42 s", "2 min 31 s", or "—" when unknown. */
export function duration(seconds: number | null): string {
    if (seconds === null) return '—';
    if (seconds < 60) return `${seconds} s`;
    return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

const OUTCOMES = new Map([
    ['success', 'passed'],
    ['failure', 'failed'],
    ['timed_out', 'timed out'],
    ['cancelled', 'cancelled'],
    ['skipped', 'skipped'],
]);
const UNFINISHED = new Map([
    ['in_progress', 'running'],
    ['queued', 'queued'],
    ['waiting', 'queued'],
    ['pending', 'queued'],
]);
const OUTCOME_ORDER = ['failed', 'timed out', 'running', 'queued', 'passed', 'cancelled', 'skipped'];

/** A run's jobs by outcome, worst first: "1 failed, 7 passed, 1 skipped". */
export function tally(jobs: readonly { status: string; conclusion: string | null }[]): string {
    const counts = new Map<string, number>();
    for (const job of jobs) {
        const outcome = job.conclusion ? OUTCOMES.get(job.conclusion) ?? job.conclusion : UNFINISHED.get(job.status) ?? job.status;
        counts.set(outcome, (counts.get(outcome) ?? 0) + 1);
    }
    const rank = (outcome: string) => {
        const index = OUTCOME_ORDER.indexOf(outcome);
        return index === -1 ? OUTCOME_ORDER.length : index;
    };
    return [...counts]
        .sort(([a], [b]) => rank(a) - rank(b))
        .map(([outcome, count]) => `${count} ${outcome}`)
        .join(', ');
}

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'error', 'moderate', 'warning', 'low', 'note', 'unknown'];

/** Alert counts by severity, worst first; a severity the page doesn't know goes last. */
export function worstFirst(bySeverity: Record<string, number>): [string, number][] {
    const rank = (level: string) => {
        const index = SEVERITY_ORDER.indexOf(level);
        return index === -1 ? SEVERITY_ORDER.length : index;
    };
    return Object.entries(bySeverity).sort(([a], [b]) => rank(a) - rank(b));
}

export function severityTone(level: string): StateTone {
    if (['critical', 'high', 'error'].includes(level)) return 'danger';
    if (['medium', 'moderate', 'warning'].includes(level)) return 'warning';
    return 'neutral';
}

/**
 * SonarQube Cloud's verdict in words. NONE means the project has no verdict
 * yet: its first analysis sets the baseline that "new code" is measured from.
 */
export function gateLabel(status: string): string {
    switch (status) {
        case 'OK':
            return 'gate passed';
        case 'ERROR':
            return 'gate failed';
        case 'NONE':
            return 'no verdict yet';
        default:
            return `gate ${status.toLowerCase()}`;
    }
}

const METRICS = new Map([
    ['new_coverage', 'coverage of new code'],
    ['new_duplicated_lines_density', 'duplication in new code'],
    ['new_security_rating', 'security of new code'],
    ['new_reliability_rating', 'reliability of new code'],
    ['new_maintainability_rating', 'maintainability of new code'],
    ['new_security_hotspots_reviewed', 'security hotspots reviewed'],
]);
const RATINGS = ['A', 'B', 'C', 'D', 'E'];
const PERCENTAGES = new Set(['new_coverage', 'new_duplicated_lines_density', 'new_security_hotspots_reviewed', 'coverage', 'duplicated_lines_density', 'security_hotspots_reviewed']);

/** A condition's value as Sonar means it: a rating as its letter, a percentage with %, a count as it is. */
function conditionValue(metric: string, value: string): string {
    if (metric.endsWith('_rating')) return RATINGS[Number(value) - 1] ?? value;
    if (PERCENTAGES.has(metric)) return `${Number.parseFloat(value).toFixed(1)} %`;
    return value;
}

/** What a condition asks for: a rating's letter, or a bound (LT fails below it, GT above it). */
function wanted(condition: { metric: string; comparator: string | null; threshold: string }): string {
    const bound = conditionValue(condition.metric, condition.threshold);
    if (condition.metric.endsWith('_rating')) return bound === 'A' ? 'A' : `${bound} or better`;
    if (condition.comparator === 'LT') return `at least ${bound}`;
    if (condition.comparator === 'GT') return `at most ${bound}`;
    return bound;
}

export interface GateCondition {
    metric: string;
    status: string;
    comparator: string | null;
    actual: string | null;
    threshold: string | null;
}

/** Why a quality gate failed, condition by condition: "coverage of new code 72.4 % (the gate wants at least 80.0 %)". */
export function failedConditions(conditions: readonly GateCondition[]): string[] {
    return conditions.flatMap((condition) => {
        const { metric, actual, threshold } = condition;
        if (condition.status !== 'ERROR' || actual === null || threshold === null) return [];
        const name = METRICS.get(metric) ?? metric.replaceAll('_', ' ');
        return [`${name} ${conditionValue(metric, actual)} (the gate wants ${wanted({ metric, comparator: condition.comparator, threshold })})`];
    });
}

/** A reason as a sentence, so the words after it don't run on: "ops-api could not be reached (ECONNREFUSED)." */
export function sentence(text: string): string {
    const trimmed = text.trim();
    return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

const PLATFORMS = new Map([
    ['eks', 'Amazon EKS'],
    ['kind', 'Kind'],
]);

/** Where the cluster runs, by the name ops-api's platform facts give it (PLATFORM_TARGET). */
export function platformLabel(target: string): string {
    return PLATFORMS.get(target) ?? target;
}

/**
 * Keys for a list whose items can repeat (log lines at the same millisecond):
 * the item's own key, with a counter only on the repeats.
 */
export function uniqueKeys<T>(items: readonly T[], keyOf: (item: T) => string): [string, T][] {
    const seen = new Map<string, number>();
    return items.map((item) => {
        const key = keyOf(item);
        const repeats = seen.get(key) ?? 0;
        seen.set(key, repeats + 1);
        return [repeats === 0 ? key : `${key}#${repeats}`, item];
    });
}

/**
 * An image reference split for reading: the repository, and the digest cut to
 * its first 12 and last 7 characters. The page keeps the whole reference for
 * copying and in the digest's title.
 */
export function imageParts(image: string): { repository: string; digest: string | null } {
    const at = image.indexOf('@');
    if (at === -1) return { repository: image, digest: null };
    const digest = image.slice(at + 1);
    const colon = digest.indexOf(':');
    const hex = colon === -1 ? '' : digest.slice(colon + 1);
    return {
        repository: image.slice(0, at),
        digest: hex.length > 19 ? `${digest.slice(0, colon)}:${hex.slice(0, 12)}…${hex.slice(-7)}` : digest,
    };
}
