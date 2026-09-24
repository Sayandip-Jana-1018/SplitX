/**
 * B-027's measurements (scripts/memory-sample.mjs, D-099): parsing what Linux
 * reports about memory, and summing a run's samples up. No I/O here.
 */

const MB = 1024 * 1024;

/** /proc/meminfo, in MB: what the machine holds and in what form. */
export function parseMeminfo(text) {
    const kb = Object.fromEntries(text.split('\n').map((line) => /^(\w+):\s+(\d+) kB/.exec(line)).filter(Boolean).map((m) => [m[1], Number(m[2])]));
    const mb = (value) => Math.round((value ?? 0) / 1024);
    return {
        total: mb(kb.MemTotal),
        used: mb((kb.MemTotal ?? 0) - (kb.MemAvailable ?? 0)),
        anon: mb(kb.AnonPages),
        shmem: mb(kb.Shmem),
        cached: mb(kb.Cached),
        swap: mb((kb.SwapTotal ?? 0) - (kb.SwapFree ?? 0)),
    };
}

/** A cgroup v2 memory.stat, in MB: a Kind node's anonymous memory, page cache and shared memory. */
export function parseMemoryStat(text) {
    const bytes = Object.fromEntries(text.split('\n').map((line) => line.trim().split(' ')).filter((parts) => parts.length === 2).map(([key, value]) => [key, Number(value)]));
    return { anon: Math.round((bytes.anon ?? 0) / MB), file: Math.round((bytes.file ?? 0) / MB), shmem: Math.round((bytes.shmem ?? 0) / MB) };
}

/** The CSV's columns, for the host and each node, in a fixed order. */
export function columns(nodes) {
    return ['time', 'phase', 'used', 'anon', 'shmem', 'cached', 'swap', ...nodes.flatMap((node) => [node + ':anon', node + ':file', node + ':shmem'])];
}

/**
 * The run in a few numbers per series: where it started, its peak and the
 * phase it peaked in, and where it ended; the series that grew most first.
 */
export function summarise(rows) {
    if (rows.length === 0) return [];
    const series = Object.keys(rows[0]).filter((key) => key !== 'time' && key !== 'phase');
    return series
        .map((name) => {
            const values = rows.map((row) => Number(row[name]) || 0);
            const peak = Math.max(...values);
            const at = values.indexOf(peak);
            return { name, start: values[0], peak, peakPhase: rows[at].phase, peakTime: rows[at].time, end: values.at(-1), growth: peak - values[0] };
        })
        .sort((a, b) => b.growth - a.growth);
}
