#!/usr/bin/env node
/**
 * Tests the alerting configuration with the tools Prometheus and Alertmanager
 * ship, at the versions kube-prometheus-stack deploys (helm/platform/charts.json).
 *
 *   npm run test:alerts
 *
 *   1. promtool check rules   the SplitX rules parse, and every expression is valid PromQL
 *   2. promtool test rules    monitoring/tests/splitx-rules.test.yaml: each alert fires on
 *                             what it should and stays silent on what it should not
 *   3. amtool check-config    monitoring/alertmanager/alertmanager.yaml, filled with example
 *                             values the way `npm run k8s:up` fills it from .env
 *
 * The rules are read out of k8s/base/prometheusrule.yaml, everything below
 * `spec:` one level less indented, so the rules tested are the rules deployed.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROMETHEUS_IMAGE = 'quay.io/prometheus/prometheus:v3.14.0@sha256:5ce7540c3c00ef4ab0c9d2c995c6a5b9c421f44b4a115d97a2c7af3b1c21cbb0';
const ALERTMANAGER_IMAGE = 'quay.io/prometheus/alertmanager:v0.34.0@sha256:690c7b525f4367aa91f73e2f91c632206d32e97c6384bdbf2fb7a861b420340d';
// Docker wants forward slashes in -v paths on Windows.
const BACKSLASH = String.fromCharCode(92);

function ruleFile() {
    const lines = readFileSync(join(root, 'k8s/base/prometheusrule.yaml'), 'utf8').split(/\r?\n/);
    const spec = lines.indexOf('spec:');
    if (spec < 0) throw new Error('k8s/base/prometheusrule.yaml has no top-level spec:');
    return lines.slice(spec + 1).map((line) => {
        if (line.trim() === '') return '';
        if (!line.startsWith('  ')) throw new Error('prometheusrule.yaml: keep spec: the last top-level key, found: ' + line);
        return line.slice(2);
    }).join('\n');
}

function alertmanagerConfig() {
    const example = {
        ALERT_EMAIL_TO: 'alerts@example.com',
        ALERT_SMTP_USERNAME: 'sender@example.com',
        ALERT_SMTP_PASSWORD: 'abcdefghijklmnop',
    };
    let config = readFileSync(join(root, 'monitoring/alertmanager/alertmanager.yaml'), 'utf8');
    for (const [key, value] of Object.entries(example)) config = config.split('${' + key + '}').join(JSON.stringify(value));
    const left = config.match(/\$\{[A-Z_]+\}/);
    if (left) throw new Error('alertmanager.yaml has a placeholder neither k8s:up nor this test fills: ' + left[0]);
    return config;
}

const work = mkdtempSync(join(tmpdir(), 'splitx-alerts-'));
// The tools run as an unprivileged user inside their containers.
chmodSync(work, 0o755);
let failed = 0;
try {
    writeFileSync(join(work, 'splitx.rules.yaml'), ruleFile());
    copyFileSync(join(root, 'monitoring/tests/splitx-rules.test.yaml'), join(work, 'splitx-rules.test.yaml'));
    writeFileSync(join(work, 'alertmanager.yaml'), alertmanagerConfig());

    const mount = work.split(BACKSLASH).join('/') + ':/work:ro';
    const tool = (image, entrypoint, argv) => spawnSync(
        'docker',
        ['run', '--rm', '-v', mount, '-w', '/work', '--entrypoint', entrypoint, image, ...argv],
        { stdio: 'inherit' }
    ).status;

    const steps = [
        ['promtool check rules', () => tool(PROMETHEUS_IMAGE, 'promtool', ['check', 'rules', 'splitx.rules.yaml'])],
        ['promtool test rules', () => tool(PROMETHEUS_IMAGE, 'promtool', ['test', 'rules', 'splitx-rules.test.yaml'])],
        ['amtool check-config', () => tool(ALERTMANAGER_IMAGE, 'amtool', ['check-config', 'alertmanager.yaml'])],
    ];
    for (const [name, step] of steps) {
        console.log('\n── ' + name);
        const code = step();
        if (code !== 0) {
            failed += 1;
            console.log('FAILED: ' + name + ' exited ' + code);
        }
    }
} finally {
    rmSync(work, { recursive: true, force: true });
}

console.log(failed ? '\n' + failed + ' of 3 alerting checks failed' : '\nAll 3 alerting checks passed');
process.exit(failed ? 1 : 0);
