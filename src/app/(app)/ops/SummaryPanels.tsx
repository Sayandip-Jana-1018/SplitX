'use client';

import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Activity, Boxes, Check, Copy, GitBranch, PackageCheck, Rocket, ShieldCheck, Workflow } from 'lucide-react';
import { IconTile, ListGroup, ListRow, Section, Tag } from '@/components/ui/kit';
import type { ClusterReadings } from '@/lib/ops/cluster';
import type { AlertCounts, CodeScanning, Delivery, Pipeline, SiteChecks, ToolScan } from '@/lib/ops/github';
import { JENKINS_ENVIRONMENTS } from '@/lib/ops/github';
import { duration, failedConditions, gateLabel, imageParts, platformLabel, severityTone, stateLabel, tally, toneOf, worstFirst } from '@/lib/ops/present';
import type { QualityGate } from '@/lib/ops/quality';
import type { Reading } from '@/lib/ops/reading';
import { cn, timeAgo } from '@/lib/utils';
import { Footnote, SEP, Source, Unavailable } from './parts';
import styles from './ops.module.css';

/*
 * The pipeline half of /ops (D-096, D-098): what GitHub and SonarQube Cloud
 * say about main right now. Every verdict is the tool's own; where a source
 * can't be read the page says why, and where a tool has never reported it
 * says that instead of showing a clean result.
 */

export interface OpsSummary {
    pipeline: Reading<Pipeline | null>;
    codeScanning: Reading<CodeScanning>;
    dependabot: Reading<AlertCounts & { capped: boolean }>;
    deliveries: Reading<Delivery[]>;
    qualityGate: Reading<QualityGate>;
    siteChecks: Reading<SiteChecks | null>;
    site: string | null;
}

const short = (sha: string) => sha.slice(0, 7);

/** The newest delivery among some environments. */
function newestOf(deliveries: Reading<Delivery[]>, environments: (environment: string) => boolean): Delivery | undefined {
    if (!deliveries.ok) return undefined;
    return deliveries.data
        .filter((delivery) => environments(delivery.environment))
        .reduce<Delivery | undefined>((newest, delivery) => (!newest || delivery.createdAt > newest.createdAt ? delivery : newest), undefined);
}

/* ── The release ──────────────────────────────────────────────────── */

function Digest({ image }: Readonly<{ image: string }>) {
    const [copied, setCopied] = useState(false);
    const { repository, digest } = imageParts(image);

    async function copy() {
        try {
            await navigator.clipboard.writeText(image);
            setCopied(true);
            globalThis.setTimeout(() => setCopied(false), 1600);
        } catch {
            // A refused clipboard (an insecure page, a denied permission) leaves the reference on screen to read.
            setCopied(false);
        }
    }

    return (
        <span className={styles.digest}>
            <span className={styles.digestRepository}>{repository}</span>
            <span className={styles.digestLine}>
                <span className={styles.digestValue} title={image}>{digest ?? 'no digest'}</span>
                <button type="button" className={styles.copy} onClick={copy} aria-label={copied ? 'Copied' : 'Copy the image reference'}>
                    {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
                </button>
            </span>
        </span>
    );
}

function ReleaseTags({ release }: Readonly<{ release: Pipeline['release'] }>) {
    if (!release) return <Tag>no release for this run</Tag>;
    return (
        <>
            <Tag tone={release.scanned ? 'success' : 'danger'}>{release.scanned ? 'scanned: no fixable critical or high' : 'scan gate not passed'}</Tag>
            <Tag tone={release.signed ? 'success' : 'danger'}>{release.signed ? 'signed (cosign, keyless)' : 'not signed'}</Tag>
            <Tag tone={release.attested ? 'success' : 'danger'}>{release.attested ? 'SBOM and vulnerabilities attested' : 'not attested'}</Tag>
        </>
    );
}

export function ReleaseCard({ pipeline, deliveries }: Readonly<{ pipeline: Reading<Pipeline | null>; deliveries: Reading<Delivery[]> }>) {
    const run = pipeline.ok ? pipeline.data : null;
    const verdict = run ? run.conclusion ?? run.status : null;
    const image = run && deliveries.ok ? deliveries.data.find((delivery) => delivery.sha === run.commit.sha && delivery.image)?.image : null;

    return (
        <div className={cn(styles.card, styles.centred)}>
            <span className={styles.cardTitle}>The release on main</span>
            {run ? (
                <>
                    <span className={styles.commit}>
                        <span className={styles.sha}>{short(run.commit.sha)}</span>
                        <span className={styles.message}>{run.commit.message}</span>
                    </span>
                    <span className={styles.tags}>
                        <Tag tone={toneOf(verdict)}>CI {stateLabel(verdict)}</Tag>
                        <ReleaseTags release={run.release} />
                    </span>
                    {image ? <Digest image={image} /> : null}
                    <span className={styles.meta}>
                        started {timeAgo(run.startedAt)}{SEP}<a className={styles.link} href={run.url} target="_blank" rel="noreferrer">open the run</a>
                    </span>
                </>
            ) : (
                <Unavailable reading={pipeline} />
            )}
            <Footnote><Source reading={pipeline} /></Footnote>
        </div>
    );
}

export function JoinCard({ site }: Readonly<{ site: string | null }>) {
    const demoUrl = site ? `${site}/scale` : null;
    return (
        <div className={cn(styles.card, styles.centred)}>
            <span className={styles.cardTitle}>Join the demo</span>
            {demoUrl ? (
                <>
                    <div className={styles.qrCode}>
                        <QRCodeSVG value={demoUrl} size={148} />
                    </div>
                    <span className={styles.qrCaption}>{demoUrl}</span>
                </>
            ) : (
                <p className={styles.unavailable}>This deployment doesn&apos;t know its public address (NEXTAUTH_URL).</p>
            )}
        </div>
    );
}

/* ── The tools ────────────────────────────────────────────────────── */

function Counts({ counts, capped }: Readonly<{ counts: AlertCounts; capped: boolean }>) {
    if (counts.total === 0) return <Tag tone="success">no open alerts</Tag>;
    // One page of alerts is read; when it's full, each count is a floor.
    const floor = capped ? '+' : '';
    return (
        <span className={styles.counts}>
            {worstFirst(counts.bySeverity).map(([level, count]) => (
                <Tag key={level} tone={severityTone(level)}>{`${count}${floor} ${level}`}</Tag>
            ))}
        </span>
    );
}

const NO_ALERTS: AlertCounts = { total: 0, bySeverity: {} };

/** A code scanning tool: its open alerts, but only once it has analysed main at least once. */
function ScanRow({ tool, what, reading }: Readonly<{ tool: 'CodeQL' | 'Trivy'; what: string; reading: Reading<CodeScanning> }>) {
    const icon = tool === 'CodeQL' ? <ShieldCheck size={18} /> : <PackageCheck size={18} />;
    if (!reading.ok) {
        return <ListRow wrap leading={<IconTile tone="accent">{icon}</IconTile>} title={tool} subtitle={what} trailing={<Tag>unavailable</Tag>} />;
    }
    const scan: ToolScan | undefined = reading.data.scans[tool];
    if (!scan) {
        return <ListRow wrap leading={<IconTile tone="accent">{icon}</IconTile>} title={tool} subtitle={`${what}: no analysis of main yet`} trailing={<Tag>no scan yet</Tag>} />;
    }
    const analysed = [`${what}: analysed ${short(scan.commit)}, ${timeAgo(scan.at)}`, scan.error].filter(Boolean).join('. ');
    return (
        <ListRow
            wrap
            leading={<IconTile tone="accent">{icon}</IconTile>}
            title={tool}
            subtitle={analysed}
            trailing={<Counts counts={reading.data.tools[tool] ?? NO_ALERTS} capped={reading.data.capped} />}
        />
    );
}

function SonarRow({ reading }: Readonly<{ reading: Reading<QualityGate> }>) {
    const leading = <IconTile tone="accent"><ShieldCheck size={18} /></IconTile>;
    if (!reading.ok) return <ListRow wrap leading={leading} title="SonarQube Cloud" subtitle="The quality gate on main" trailing={<Tag>unavailable</Tag>} />;
    const { status, analysis, conditions } = reading.data;
    const failures = failedConditions(conditions);
    const analysed = analysis ? `analysed ${analysis.revision ? short(analysis.revision) : 'main'}, ${timeAgo(analysis.at)}` : 'not analysed yet';
    return (
        <ListRow
            wrap
            leading={leading}
            title="SonarQube Cloud"
            subtitle={failures.length > 0 ? `${analysed}. ${failures.join('; ')}` : `The quality gate on main: ${analysed}`}
            trailing={<Tag tone={toneOf(status)}>{gateLabel(status)}</Tag>}
        />
    );
}

function DeliveryTool({ tool, delivery, fallback }: Readonly<{ tool: string; delivery: Delivery | undefined; fallback: string }>) {
    return (
        <ListRow
            wrap
            leading={<IconTile tone="accent"><Rocket size={18} /></IconTile>}
            title={tool}
            subtitle={delivery ? `${delivery.environment}, ${short(delivery.sha)}` : fallback}
            trailing={delivery ? <Tag tone={toneOf(delivery.state)}>{stateLabel(delivery.state)}</Tag> : <Tag>unavailable</Tag>}
        />
    );
}

/** The production checks (uptime.yml, D-106): the newest finished run's verdict on the live site. */
function SiteChecksRow({ reading }: Readonly<{ reading: Reading<SiteChecks | null> }>) {
    const leading = <IconTile tone="accent"><Activity size={18} /></IconTile>;
    const what = 'The live site, every 15 minutes';
    if (!reading.ok) return <ListRow wrap leading={leading} title="Production checks" subtitle={what} trailing={<Tag>unavailable</Tag>} />;
    const run = reading.data;
    if (!run) return <ListRow wrap leading={leading} title="Production checks" subtitle={`${what}: no run yet`} trailing={<Tag>no report yet</Tag>} />;
    return (
        <ListRow
            wrap
            leading={leading}
            title="Production checks"
            subtitle={`${what}: last run ${timeAgo(run.at)}`}
            trailing={<Tag tone={toneOf(run.conclusion)}>{stateLabel(run.conclusion)}</Tag>}
        />
    );
}

function platformName(cluster: Reading<ClusterReadings> | undefined): string {
    const platform = cluster?.ok && cluster.data.platform.ok ? cluster.data.platform.data : null;
    if (!platform) return 'Kubernetes, Prometheus, Grafana, Loki, Kyverno';
    return `Kubernetes on ${platformLabel(platform.target)}, with Prometheus, Grafana, Loki and Kyverno`;
}

export function ToolsSection({ summary, cluster }: Readonly<{ summary: OpsSummary; cluster: Reading<ClusterReadings> | undefined }>) {
    const run = summary.pipeline.ok ? summary.pipeline.data : null;
    const verdict = run ? run.conclusion ?? run.status : null;
    const dependabot = summary.dependabot;
    // Why a row says "unavailable". The pipeline's and the deliveries' reasons show in their own sections.
    const reasons = [summary.codeScanning, dependabot, summary.qualityGate, summary.siteChecks].flatMap((reading) =>
        reading.ok ? [] : [{ source: reading.source, error: reading.error }]
    );

    return (
        <Section centered title="Tools" subtitle="Each tool's latest verdict, from the tool itself.">
            <ListGroup>
                <ListRow
                    wrap
                    leading={<IconTile tone="accent"><Workflow size={18} /></IconTile>}
                    title="GitHub Actions"
                    subtitle={run ? `Tests, the real database, the image and the release: ${tally(run.jobs)}` : 'Tests, the real database, the image and the release'}
                    trailing={<Tag tone={toneOf(verdict)}>{run ? stateLabel(verdict) : 'unavailable'}</Tag>}
                />
                <ScanRow tool="CodeQL" what="The code and the workflows" reading={summary.codeScanning} />
                <ScanRow tool="Trivy" what="The released image" reading={summary.codeScanning} />
                <ListRow
                    wrap
                    leading={<IconTile tone="accent"><GitBranch size={18} /></IconTile>}
                    title="Dependabot"
                    subtitle="Known vulnerabilities in the dependencies"
                    trailing={dependabot.ok ? <Counts counts={dependabot.data} capped={dependabot.data.capped} /> : <Tag>unavailable</Tag>}
                />
                <SonarRow reading={summary.qualityGate} />
                <DeliveryTool
                    tool="Jenkins"
                    delivery={newestOf(summary.deliveries, (environment) => JENKINS_ENVIRONMENTS.includes(environment))}
                    fallback="Deploys signed releases to the cluster"
                />
                <DeliveryTool tool="Vercel" delivery={newestOf(summary.deliveries, (environment) => environment === 'Production')} fallback="Deploys every push to main" />
                <SiteChecksRow reading={summary.siteChecks} />
                <ListRow
                    wrap
                    leading={<IconTile tone="neutral"><Boxes size={18} /></IconTile>}
                    title="The platform"
                    subtitle={platformName(cluster)}
                    trailing={cluster?.ok ? <Tag tone="success">connected</Tag> : <Tag>not connected here</Tag>}
                />
            </ListGroup>
            {reasons.map((reason) => (
                <Footnote key={reason.source}>
                    {reason.source}: {reason.error}.
                </Footnote>
            ))}
        </Section>
    );
}

/* ── The pipeline and the deliveries ──────────────────────────────── */

export function PipelineSection({ pipeline }: Readonly<{ pipeline: Reading<Pipeline | null> }>) {
    const run = pipeline.ok ? pipeline.data : null;
    return (
        <Section centered title="Pipeline" subtitle={run ? `The jobs of ${short(run.commit.sha)}: ${tally(run.jobs)}` : undefined}>
            {run ? (
                <ListGroup>
                    {run.jobs.map((job) => (
                        <ListRow
                            key={job.name}
                            title={job.name}
                            trailing={<Tag tone={toneOf(job.conclusion ?? job.status)}>{stateLabel(job.conclusion ?? job.status)}</Tag>}
                            // A skipped job never ran: it has no duration to show.
                            trailingSub={job.conclusion === 'skipped' ? undefined : duration(job.seconds)}
                        />
                    ))}
                </ListGroup>
            ) : (
                <Unavailable reading={pipeline} />
            )}
            <Footnote><Source reading={pipeline} /></Footnote>
        </Section>
    );
}

function deliveryLine(delivery: Delivery): string {
    const digest = delivery.image ? imageParts(delivery.image).digest : null;
    return [delivery.deployer, short(delivery.sha), digest].filter(Boolean).join(' · ');
}

export function DeliveriesSection({ deliveries }: Readonly<{ deliveries: Reading<Delivery[]> }>) {
    return (
        <Section centered title="Deliveries" subtitle="Each environment's newest deployment, and what its deployer reported.">
            {deliveries.ok && deliveries.data.length > 0 ? (
                <ListGroup>
                    {deliveries.data.map((delivery) => (
                        <ListRow
                            key={delivery.environment}
                            wrap
                            title={delivery.environment}
                            subtitle={<span className={styles.mono}>{deliveryLine(delivery)}</span>}
                            meta={delivery.description ? <span className={styles.rowNote}>{delivery.description}</span> : undefined}
                            trailing={<Tag tone={toneOf(delivery.state)}>{stateLabel(delivery.state)}</Tag>}
                            trailingSub={timeAgo(delivery.reportedAt ?? delivery.createdAt)}
                        />
                    ))}
                </ListGroup>
            ) : null}
            {deliveries.ok && deliveries.data.length === 0 ? <p className={styles.empty}>No deployment yet.</p> : null}
            <Unavailable reading={deliveries} />
            <Footnote><Source reading={deliveries} /></Footnote>
        </Section>
    );
}
