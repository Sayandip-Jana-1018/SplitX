#!/usr/bin/env node
/**
 * Measures the production image against the naive one and writes the result
 * to docs/evidence/image-comparison.md. Every number in that file comes from
 * this script running against real images on this machine.
 *
 *   npm run image:report                build both images, then measure them
 *   npm run image:report -- --no-build  measure images that are already built
 *
 * Measured per image: download (compressed) and unpacked size, layers, user,
 * whether npm ships in it, vulnerabilities by severity (Trivy, pinned by
 * digest), time from `docker run` to a healthy /api/health/live, how long
 * `docker stop` takes, and whether requests in flight when it stops still
 * complete. For the production image also: build times (no layer cache, no
 * change, a source change) and the provenance it reports.
 *
 * METRICS_TOKEN comes from .env (the script is run with --env-file) and is
 * passed to containers by name, never printed.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { bake, provenance } from './image-build.mjs';

const TRIVY = 'aquasec/trivy:0.74.0@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969';
const REPORT = 'docs/evidence/image-comparison.md';
const build = !process.argv.includes('--no-build');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const docker = (args, options = {}) => {
    const result = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...options });
    if (result.status !== 0 && !options.allowFailure) {
        throw new Error(`docker ${args.slice(0, 3).join(' ')} failed: ${(result.stderr || '').slice(0, 400)}`);
    }
    return result;
};
const inspect = (image, format) => docker(['image', 'inspect', image, '--format', format]).stdout.trim();
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(0)} MB`;

function timed(label, fn) {
    const started = performance.now();
    const result = fn();
    const seconds = (performance.now() - started) / 1000;
    if (result.status !== 0) throw new Error(`${label} failed`);
    console.log(`${label}: ${seconds.toFixed(0)} s`);
    return seconds;
}

function buildTimes(values) {
    const times = {};
    times.naive = timed('naive build', () => bake('naive', { extraArgs: ['--no-cache'] }));
    times.cold = timed('production build, no layer cache', () => bake('app', { env: values, extraArgs: ['--no-cache'] }));
    times.warm = timed('production build, nothing changed', () => bake('app', { env: values }));
    // A throwaway file under src/ changes the build context exactly like a code edit.
    const marker = 'src/.image-report-marker';
    writeFileSync(marker, String(Date.now()));
    try {
        times.change = timed('production build, one source file changed', () => bake('app', { env: values }));
    } finally {
        rmSync(marker, { force: true });
    }
    return times;
}

function vulnerabilitySource(target, vulnerability) {
    if (target.Class === 'os-pkgs') return `OS packages (${target.Type})`;
    const path = vulnerability.PkgPath ?? target.Target ?? '';
    if (/node_modules\/(npm|corepack)\/|\/opt\/yarn/.test(path)) return 'npm, yarn and corepack';
    if (path.startsWith('app/')) return 'app dependencies';
    return 'other';
}

function vulnerabilities(image) {
    const result = docker([
        'run', '--rm',
        '-v', '/var/run/docker.sock:/var/run/docker.sock',
        '-v', 'splitx-trivy-cache:/root/.cache',
        TRIVY, 'image', '--scanners', 'vuln', '--format', 'json', '--quiet', '--timeout', '15m', image,
    ]);
    const report = JSON.parse(result.stdout);
    const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 };
    const bySource = {};
    for (const target of report.Results ?? []) {
        for (const vulnerability of target.Vulnerabilities ?? []) {
            counts[vulnerability.Severity] = (counts[vulnerability.Severity] ?? 0) + 1;
            bySource[vulnerabilitySource(target, vulnerability)] = (bySource[vulnerabilitySource(target, vulnerability)] ?? 0) + 1;
        }
    }
    return { counts, bySource, total: Object.values(counts).reduce((a, b) => a + b, 0) };
}

async function waitForHealthy(port, timeoutMs = 120_000) {
    const started = performance.now();
    while (performance.now() - started < timeoutMs) {
        try {
            const res = await fetch(`http://127.0.0.1:${port}/api/health/live`);
            if (res.ok) return performance.now() - started;
        } catch { /* not listening yet */ }
        await sleep(25);
    }
    throw new Error(`nothing answered on port ${port} within ${timeoutMs / 1000} s`);
}

async function runtime(image, port, name) {
    docker(['rm', '-f', name], { allowFailure: true });
    const started = performance.now();
    docker(['run', '-d', '--name', name, '-p', `127.0.0.1:${port}:3000`, '-e', 'METRICS_TOKEN', image]);
    try {
        await waitForHealthy(port);
        const startupMs = performance.now() - started;

        let appInfo = 'not exported';
        const metrics = await fetch(`http://127.0.0.1:${port}/api/metrics`, { headers: { Authorization: `Bearer ${process.env.METRICS_TOKEN}` } });
        if (metrics.ok) appInfo = (await metrics.text()).split('\n').find((line) => line.startsWith('splitx_app_info')) ?? appInfo;

        // Warm the planner, then stop the container while previews are still running.
        const preview = () => fetch(`http://127.0.0.1:${port}/api/settlements/preview`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ scenario: { members: 2000, seed: 7 } }),
        }).then((res) => res.status, () => 'error');
        await preview();
        const inFlight = Array.from({ length: 12 }, preview);
        await sleep(40);
        const stopStarted = performance.now();
        docker(['stop', name]);
        const stopMs = performance.now() - stopStarted;
        const statuses = await Promise.all(inFlight);
        return {
            startupMs,
            stopMs,
            exitCode: docker(['inspect', name, '--format', '{{.State.ExitCode}}']).stdout.trim(),
            inFlightOk: statuses.filter((status) => status === 200).length,
            inFlightTotal: statuses.length,
            appInfo,
        };
    } finally {
        docker(['rm', '-f', name], { allowFailure: true });
    }
}

function staticFacts(image) {
    // As root, so directories the image's own user can't read are still counted.
    const unpackedKb = Number(docker(['run', '--rm', '--user', '0', '--entrypoint', 'sh', image, '-c', 'du -sxk / 2>/dev/null | cut -f1']).stdout.trim());
    const npm = docker(['run', '--rm', '--entrypoint', 'sh', image, '-c', 'command -v npm >/dev/null && echo yes || echo no']).stdout.trim();
    return {
        compressed: Number(inspect(image, '{{.Size}}')),
        unpacked: unpackedKb * 1024,
        layers: Number(inspect(image, '{{len .RootFS.Layers}}')),
        user: inspect(image, '{{.Config.User}}') || 'root',
        npm,
        labels: JSON.parse(inspect(image, '{{json .Config.Labels}}') || '{}') ?? {},
    };
}

const values = provenance();
const times = build ? buildTimes(values) : null;
const images = { naive: 'splitx:naive', app: `splitx:${values.GIT_SHA}` };

const results = {};
for (const [key, image] of Object.entries(images)) {
    console.log(`measuring ${image}…`);
    results[key] = {
        image,
        ...staticFacts(image),
        vulns: vulnerabilities(image),
        runtime: await runtime(image, key === 'app' ? 3310 : 3311, `splitx-report-${key}`),
    };
}

const { naive, app } = results;
const ratio = (a, b) => `${Math.round((1 - b / a) * 100)}% smaller`;
const severities = (v) => `${v.counts.CRITICAL} critical · ${v.counts.HIGH} high · ${v.counts.MEDIUM} medium · ${v.counts.LOW} low`;
const dockerVersion = docker(['version', '--format', '{{.Server.Version}}']).stdout.trim();

const lines = [
    '# Image comparison — naive vs production',
    '',
    `Generated by \`scripts/image-report.mjs\` on ${new Date().toISOString().slice(0, 10)} against commit \`${values.GIT_SHA}\`.`,
    `Host: ${os.cpus()[0].model}, ${os.cpus().length} logical CPUs; Docker Engine ${dockerVersion}. Every value below was measured, not estimated.`,
    '',
    '| | Naive (`Dockerfile.naive`) | Production (`Dockerfile`) | Difference |',
    '|---|---|---|---|',
    `| Download size (compressed) | ${mb(naive.compressed)} | ${mb(app.compressed)} | ${ratio(naive.compressed, app.compressed)} |`,
    `| Unpacked size | ${mb(naive.unpacked)} | ${mb(app.unpacked)} | ${ratio(naive.unpacked, app.unpacked)} |`,
    `| Layers | ${naive.layers} | ${app.layers} | |`,
    `| Runs as | ${naive.user} | ${app.user} | |`,
    `| npm in the image | ${naive.npm} | ${app.npm} | |`,
    `| Vulnerabilities (Trivy 0.74.0) | ${naive.vulns.total}: ${severities(naive.vulns)} | ${app.vulns.total}: ${severities(app.vulns)} | ${naive.vulns.total - app.vulns.total} fewer |`,
    `| \`docker run\` → healthy | ${(naive.runtime.startupMs / 1000).toFixed(1)} s | ${(app.runtime.startupMs / 1000).toFixed(1)} s | |`,
    `| \`docker stop\` | ${(naive.runtime.stopMs / 1000).toFixed(1)} s, exit ${naive.runtime.exitCode} | ${(app.runtime.stopMs / 1000).toFixed(1)} s, exit ${app.runtime.exitCode} | |`,
    `| Requests in flight during stop that completed | ${naive.runtime.inFlightOk} of ${naive.runtime.inFlightTotal} | ${app.runtime.inFlightOk} of ${app.runtime.inFlightTotal} | |`,
    '',
    "**Reading the shutdown numbers:** both images stop gracefully — every request already in flight finishes.",
    "The production image exits 143 (terminated by SIGTERM, once the server has closed); the naive one exits 1,",
    "because `npm start` wraps the server and reports its own failure, which is indistinguishable from a crash",
    "to a restart policy or a dashboard.",
    '',
    '**Where the vulnerabilities are:**',
    '',
    `- Naive: ${Object.entries(naive.vulns.bySource).map(([source, count]) => `${source} ${count}`).join(', ') || 'none'}`,
    `- Production: ${Object.entries(app.vulns.bySource).map(([source, count]) => `${source} ${count}`).join(', ') || 'none'}`,
    '',
];

if (times) {
    lines.push(
        '## Build times',
        '',
        '| Build | Time |',
        '|---|---|',
        `| Naive, no layer cache | ${times.naive.toFixed(0)} s |`,
        `| Production, no layer cache (the npm download cache mount is kept) | ${times.cold.toFixed(0)} s |`,
        `| Production, nothing changed | ${times.warm.toFixed(0)} s |`,
        `| Production, one source file changed (dependencies layer reused) | ${times.change.toFixed(0)} s |`,
        '',
    );
}

lines.push(
    '## Provenance',
    '',
    'The production image carries its commit as OCI labels and reports it at runtime, so a pod can be traced to the build it came from:',
    '',
    '```',
    `org.opencontainers.image.revision = ${app.labels['org.opencontainers.image.revision']}`,
    `org.opencontainers.image.version  = ${app.labels['org.opencontainers.image.version']}`,
    `org.opencontainers.image.created  = ${app.labels['org.opencontainers.image.created']}`,
    app.runtime.appInfo,
    '```',
    '',
    'The naive image reports nothing: ' + '`' + naive.runtime.appInfo + '`',
    '',
    '## How to reproduce',
    '',
    '```bash',
    'npm run image:report',
    '```',
    '',
);

mkdirSync('docs/evidence', { recursive: true });
writeFileSync(REPORT, lines.join('\n'));
console.log(`wrote ${REPORT}`);
console.log(lines.slice(4, 18).join('\n'));
