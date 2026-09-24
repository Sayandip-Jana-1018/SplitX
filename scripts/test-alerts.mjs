#!/usr/bin/env node
/**
 * Tests the alerting configuration with the tools Prometheus and Alertmanager
 * ship, at the versions kube-prometheus-stack deploys (helm/platform/charts.json).
 *
 *   npm run test:alerts
 *
 *   1. promtool check rules   the rules parse, and every expression is valid PromQL
 *   2. promtool test rules    monitoring/tests/*.test.yaml: each alert fires on what it
 *                             should and stays silent on what it should not
 *   3. amtool check-config    monitoring/alertmanager/alertmanager.yaml, filled with example
 *                             values the way `npm run k8s:up` fills it from .env
 *
 * The rules are read out of the PrometheusRules that are deployed, everything
 * below `spec:` one level less indented, so the rules tested are the rules
 * deployed: the application's (k8s/base) and the delivery path's (jenkins).
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderAlertmanagerConfig } from './lib/alertmanager-config.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROMETHEUS_IMAGE = 'quay.io/prometheus/prometheus:v3.14.0@sha256:5ce7540c3c00ef4ab0c9d2c995c6a5b9c421f44b4a115d97a2c7af3b1c21cbb0';
const ALERTMANAGER_IMAGE = 'quay.io/prometheus/alertmanager:v0.34.0@sha256:690c7b525f4367aa91f73e2f91c632206d32e97c6384bdbf2fb7a861b420340d';
// Docker wants forward slashes in -v paths on Windows.
const BACKSLASH = String.fromCharCode(92);

// Each PrometheusRule manifest, the rule file promtool reads, and its tests.
const RULES = [
    { source: 'k8s/base/prometheusrule.yaml', file: 'splitx.rules.yaml', tests: 'monitoring/tests/splitx-rules.test.yaml' },
    { source: 'jenkins/prometheusrule.yaml', file: 'delivery.rules.yaml', tests: 'monitoring/tests/delivery-rules.test.yaml' },
];

function ruleFile(source) {
    const lines = readFileSync(join(root, source), 'utf8').split(/\r?\n/);
    const spec = lines.indexOf('spec:');
    if (spec < 0) throw new Error(source + ' has no top-level spec:');
    return lines.slice(spec + 1).map((line) => {
        if (line.trim() === '') return '';
        if (!line.startsWith('  ')) throw new Error(source + ': keep spec: the last top-level key, found: ' + line);
        return line.slice(2);
    }).join('\n');
}

function alertmanagerConfig() {
    const example = {
        ALERT_EMAIL_TO: 'alerts@example.com',
        ALERT_SMTP_USERNAME: 'sender@example.com',
        // Made up for each run. A literal here looked like a committed password to
        // GitGuardian (incident 37417914, a false positive), and a secret scanner
        // that cries wolf is one people learn to ignore.
        ALERT_SMTP_PASSWORD: randomBytes(8).toString('hex'),
    };
    // Filled exactly as both clusters fill it (k8s:up on Kind, aws:secrets for EKS).
    const { config, emailed } = renderAlertmanagerConfig(readFileSync(join(root, 'monitoring/alertmanager/alertmanager.yaml'), 'utf8'), example);
    if (!emailed) throw new Error('the example values did not produce the email integration');
    return config;
}

const work = mkdtempSync(join(tmpdir(), 'splitx-alerts-'));
// The tools run as an unprivileged user inside their containers.
chmodSync(work, 0o755);
let failed = 0;
try {
    for (const rules of RULES) {
        writeFileSync(join(work, rules.file), ruleFile(rules.source));
        copyFileSync(join(root, rules.tests), join(work, basename(rules.tests)));
    }
    writeFileSync(join(work, 'alertmanager.yaml'), alertmanagerConfig());

    const mount = work.split(BACKSLASH).join('/') + ':/work:ro';
    const tool = (image, entrypoint, argv) => spawnSync(
        'docker',
        ['run', '--rm', '-v', mount, '-w', '/work', '--entrypoint', entrypoint, image, ...argv],
        { stdio: 'inherit' }
    ).status;

    const steps = [
        ['promtool check rules', () => tool(PROMETHEUS_IMAGE, 'promtool', ['check', 'rules', ...RULES.map((rules) => rules.file)])],
        ['promtool test rules', () => tool(PROMETHEUS_IMAGE, 'promtool', ['test', 'rules', ...RULES.map((rules) => basename(rules.tests))])],
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
