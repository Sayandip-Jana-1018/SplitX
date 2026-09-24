#!/usr/bin/env node
/**
 * B-027 on GitHub's runner (kind-e2e.yml, D-099): what the machine's memory is
 * made of while the Kind cluster comes up and runs, sampled from before the
 * cluster exists.
 *
 * On the laptop (2026-09-21) the cluster once held about 4 GB in memory and all
 * 8 GB of its WSL VM's swap, against 4.6 GB the day before, and nothing had
 * recorded what grew. Every 10 s this records:
 *   - the machine (/proc/meminfo): in use, anonymous, shared (tmpfs and the
 *     like), page cache, swap in use;
 *   - each Kind node container's own cgroup (memory.stat): anonymous memory,
 *     page cache and shared memory;
 *   - the phase the workflow is in, from <csv>.phase, which each step writes.
 *
 *   node scripts/memory-sample.mjs run <csv>          sample until SIGTERM
 *   node scripts/memory-sample.mjs report <csv> <md> [top-pods.txt]
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { columns, parseMeminfo, parseMemoryStat, summarise } from './lib/memory.mjs';

const [command, csv, markdown, topPods] = process.argv.slice(2);
const NODES = ['splitx-control-plane', 'splitx-worker', 'splitx-worker2'];
const INTERVAL_MS = 10_000;

function nodeStat(node) {
    const result = spawnSync('docker', ['exec', node, 'cat', '/sys/fs/cgroup/memory.stat'], { encoding: 'utf8', timeout: 8_000 });
    return result.status === 0 ? parseMemoryStat(result.stdout) : { anon: '', file: '', shmem: '' };
}

function sample() {
    const host = parseMeminfo(readFileSync('/proc/meminfo', 'utf8'));
    const phase = existsSync(csv + '.phase') ? readFileSync(csv + '.phase', 'utf8').trim() : 'before the cluster';
    const nodes = NODES.flatMap((node) => {
        const stat = nodeStat(node);
        return [stat.anon, stat.file, stat.shmem];
    });
    return [new Date().toISOString(), phase, host.used, host.anon, host.shmem, host.cached, host.swap, ...nodes];
}

if (command === 'run') {
    if (!csv) throw new Error('usage: node scripts/memory-sample.mjs run <csv>');
    writeFileSync(csv, columns(NODES).join(',') + '\n');
    const host = parseMeminfo(readFileSync('/proc/meminfo', 'utf8'));
    console.log('sampling every ' + INTERVAL_MS / 1000 + ' s into ' + csv + ' (the machine has ' + host.total + ' MB)');
    let stopping = false;
    process.on('SIGTERM', () => { stopping = true; });
    process.on('SIGINT', () => { stopping = true; });
    while (!stopping) {
        appendFileSync(csv, sample().map((value) => String(value).replaceAll(',', ';')).join(',') + '\n');
        await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
    }
} else if (command === 'report') {
    if (!csv || !markdown) throw new Error('usage: node scripts/memory-sample.mjs report <csv> <md> [top-pods.txt]');
    const [header, ...lines] = readFileSync(csv, 'utf8').trim().split('\n');
    const keys = header.split(',');
    const rows = lines.map((line) => Object.fromEntries(line.split(',').map((value, index) => [keys[index], value])));
    const host = parseMeminfo(readFileSync('/proc/meminfo', 'utf8'));
    const rowsOut = summarise(rows).map((s) => '| ' + s.name + ' | ' + s.start + ' | ' + s.peak + ' | ' + s.peakPhase + ' | ' + s.end + ' |');
    const phases = [...new Set(rows.map((row) => row.phase))];
    const report = [
        '# Memory while the Kind cluster runs (B-027)',
        '',
        'Written by `scripts/memory-sample.mjs` in a `kind-e2e` run on a GitHub-hosted runner with ' + host.total + ' MB.',
        rows.length + ' samples, one every 10 s, from ' + (rows[0]?.time ?? '?') + ' to ' + (rows.at(-1)?.time ?? '?') + '.',
        '"Anonymous" is memory processes asked for; "shared" is tmpfs and shared mappings; "cache" is',
        'files kept in memory, which the kernel gives back under pressure. Each node is its own cgroup.',
        '',
        '| Series (MB) | At the start | Peak | Peak during | At the end |',
        '|---|---|---|---|---|',
        ...rowsOut,
        '',
        'Phases, in order: ' + phases.join(' → ') + '.',
        '',
        ...(topPods && existsSync(topPods)
            ? ['## The pods holding the most memory at the end', '', '```', readFileSync(topPods, 'utf8').trim(), '```', '']
            : []),
    ].join('\n');
    writeFileSync(markdown, report + '\n');
    console.log(report);
} else {
    throw new Error('usage: node scripts/memory-sample.mjs run <csv> | report <csv> <md> [top-pods.txt]');
}
