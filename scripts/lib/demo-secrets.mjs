/**
 * What the demo platform on EKS reads from AWS Secrets Manager, built from .env.
 *
 * Two JSON secrets, which the External Secrets Operator turns into Kubernetes
 * Secrets on the cluster (Phase 5), and which aws-down deletes every evening:
 *
 *   splitx/demo/app       the app's splitx-secrets
 *   splitx/demo/platform  Grafana, Alertmanager's email, Jenkins and Nexus
 *
 * Nothing here is generated on the cluster, ever: a secret made up there would
 * change on every aws-up and break what depends on it (the webhook's HMAC, the
 * edge's origin header). The two values nobody has to choose are generated
 * once, into .env, by scripts/aws-secrets.mjs.
 */

import { renderAlertmanagerConfig } from './alertmanager-config.mjs';

export const APP_SECRET = 'splitx/demo/app';
export const PLATFORM_SECRET = 'splitx/demo/platform';

/** Values the platform can't run without; aws:secrets stops when one is missing. */
export const REQUIRED = [
    // A Neon branch holding production's schema and none of its data, so the
    // classroom's accounts and expenses never mix with real users'.
    'DEMO_DATABASE_URL',
    'NEXTAUTH_SECRET',
    'METRICS_TOKEN',
    'REDIS_PASSWORD',
    'ORIGIN_VERIFY_SECRET',
    'GF_ADMIN_PASSWORD',
    'JENKINS_ADMIN_PASSWORD',
    'GITHUB_WEBHOOK_SECRET',
    'JENKINS_TRIGGER_TOKEN',
    'NEXUS_ADMIN_PASSWORD',
];

/** Copied into the app's secret as they are, when present. */
const APP_OPTIONAL = [
    'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET',
    'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
    'GEMINI_API_KEY', 'OPENAI_API_KEY',
    'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'RESEND_API_KEY', 'EMAIL_FROM',
    'OPS_ADMINS', 'OPS_GITHUB_TOKEN',
];

/**
 * The pool Prisma opens per pod: ten pods at 5 connections stay far inside
 * what a small Neon compute allows (B-010, as on the Kind cluster).
 */
export function withPool(url) {
    const parsed = new URL(url);
    if (!parsed.searchParams.has('connection_limit')) parsed.searchParams.set('connection_limit', '5');
    if (!parsed.searchParams.has('pool_timeout')) parsed.searchParams.set('pool_timeout', '10');
    return parsed.toString();
}

/**
 * The two secrets' contents from an environment (process.env after .env is
 * loaded). Returns the missing required keys instead of throwing, so the
 * caller can name all of them at once.
 * @param {Record<string, string | undefined>} env
 * @param {{ alertmanagerTemplate: string }} files  the committed monitoring/alertmanager/alertmanager.yaml
 */
export function demoSecrets(env, { alertmanagerTemplate }) {
    const value = (key) => (env[key] ?? '').trim();
    const missing = REQUIRED.filter((key) => !value(key));
    if (missing.length) return { missing, app: null, platform: null };

    /** @type {Record<string, string>} */
    const app = {
        DATABASE_URL: withPool(value('DEMO_DATABASE_URL')),
        // Prisma reads it for migrations only; the demo branch is created with
        // the schema already in place, so the same database will do.
        DIRECT_URL: value('DEMO_DIRECT_URL') || value('DEMO_DATABASE_URL'),
        // The cluster's own Redis (k8s/components/redis), never production's.
        REDIS_URL: 'redis://:' + encodeURIComponent(value('REDIS_PASSWORD')) + '@splitx-redis:6379/0',
        REDIS_PASSWORD: value('REDIS_PASSWORD'),
        NEXTAUTH_SECRET: value('NEXTAUTH_SECRET'),
        METRICS_TOKEN: value('METRICS_TOKEN'),
        // CloudFront sends it on every request to the load balancer; the app
        // refuses requests that come without it (src/proxy.ts).
        ORIGIN_VERIFY_SECRET: value('ORIGIN_VERIFY_SECRET'),
    };
    // GitHub allows one callback address per OAuth app, so the CloudFront
    // address has an app of its own (AWS_GITHUB_ID). Without it the EKS site
    // simply doesn't offer GitHub sign-in.
    if (value('AWS_GITHUB_ID') && value('AWS_GITHUB_SECRET')) {
        app.GITHUB_ID = value('AWS_GITHUB_ID');
        app.GITHUB_SECRET = value('AWS_GITHUB_SECRET');
    }
    for (const key of APP_OPTIONAL) if (value(key)) app[key] = value(key);

    // Every key the cluster's ExternalSecrets name is always present, even when
    // empty: one missing property fails the whole ExternalSecret (k8s/eks/secrets).
    /** @type {Record<string, string>} */
    const platform = {
        GF_ADMIN_PASSWORD: value('GF_ADMIN_PASSWORD'),
        JENKINS_ADMIN_PASSWORD: value('JENKINS_ADMIN_PASSWORD'),
        GITHUB_WEBHOOK_SECRET: value('GITHUB_WEBHOOK_SECRET'),
        JENKINS_TRIGGER_TOKEN: value('JENKINS_TRIGGER_TOKEN'),
        // Empty: Jenkins deploys, but reads GitHub anonymously and reports nothing (B-026).
        JENKINS_GITHUB_TOKEN: value('JENKINS_GITHUB_TOKEN'),
        NEXUS_ADMIN_PASSWORD: value('NEXUS_ADMIN_PASSWORD'),
        // Alertmanager's whole configuration, filled here exactly as k8s:up fills
        // it for Kind (D-052); without the ALERT_* values it routes but emails nobody.
        ALERTMANAGER_YAML: renderAlertmanagerConfig(alertmanagerTemplate, env).config,
    };

    return { missing: [], app, platform };
}
