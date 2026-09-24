'use client';

import type { ReactNode } from 'react';
import useSWR from 'swr';
import { QRCodeSVG } from 'qrcode.react';
import { Boxes, GitBranch, PackageCheck, Rocket, ShieldCheck, Workflow } from 'lucide-react';
import ErrorState from '@/components/ui/ErrorState';
import Skeleton from '@/components/ui/Skeleton';
import { IconTile, ListGroup, ListRow, PageIntro, Section, Tag, type Tone } from '@/components/ui/kit';
import type { ClusterReadings } from '@/lib/ops/cluster';
import type { AlertCounts, CodeScanning, Delivery, Pipeline } from '@/lib/ops/github';
import type { QualityGate } from '@/lib/ops/quality';
import type { Reading } from '@/lib/ops/reading';
import { getNetworkErrorCopy, NetworkTaggedError } from '@/lib/networkErrors';
import { fetcher } from '@/lib/swr';
import { timeAgo } from '@/lib/utils';
import ClusterPanels from './ClusterPanels';
import { REPOSITORY_URL, Source, Unavailable } from './parts';
import styles from './ops.module.css';

interface Summary {
    pipeline: Reading<Pipeline | null>;
    codeScanning: Reading<CodeScanning>;
    dependabot: Reading<AlertCounts & { capped: boolean }>;
    deliveries: Reading<Delivery[]>;
    qualityGate: Reading<QualityGate>;
    site: string | null;
}

/** Environments the release job asks Jenkins to deploy; Vercel reports its own (Production, Preview). */
const JENKINS_ENVIRONMENTS = new Set(['kind', 'eks']);
const deployer = (environment: string) => (JENKINS_ENVIRONMENTS.has(environment) ? 'Jenkins' : 'Vercel');
const SEVERITY_ORDER = ['critical', 'high', 'medium', 'error', 'moderate', 'warning', 'low', 'note', 'unknown'];

function toneOf(state: string | null | undefined): Tone {
    switch (state) {
        case 'success':
        case 'OK':
            return 'success';
        case 'failure':
        case 'error':
        case 'ERROR':
        case 'timed_out':
            return 'danger';
        case 'in_progress':
        case 'queued':
        case 'pending':
        case 'waiting':
            return 'warning';
        default:
            return 'neutral';
    }
}

const label = (state: string | null | undefined) => (state ? state.replace(/_/g, ' ') : 'no result yet');
const duration = (seconds: number | null) => (seconds === null ? '—' : seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`);

function Counts({ counts, capped }: { counts: AlertCounts; capped?: boolean }) {
    if (counts.total === 0) return <Tag tone="success">no open alerts</Tag>;
    const levels = Object.entries(counts.bySeverity).sort(([a], [b]) => SEVERITY_ORDER.indexOf(a) - SEVERITY_ORDER.indexOf(b));
    return (
        <span className={styles.counts}>
            {levels.map(([level, count]) => (
                <Tag key={level} tone={['critical', 'high', 'error'].includes(level) ? 'danger' : ['medium', 'moderate', 'warning'].includes(level) ? 'warning' : 'neutral'}>
                    {count}{capped ? '+' : ''} {level}
                </Tag>
            ))}
        </span>
    );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div className={styles.card}>
            <span className={styles.cardTitle}>{title}</span>
            {children}
        </div>
    );
}

export default function OpsPage() {
    const { data, error, mutate } = useSWR<Summary>('/api/ops/summary', fetcher, { refreshInterval: 15_000 });
    // The cluster moves faster than the pipeline: ops-api is read every 5 seconds.
    const { data: live, mutate: refreshCluster } = useSWR<{ cluster: Reading<ClusterReadings> }>('/api/ops/cluster', fetcher, { refreshInterval: 5_000 });

    if (error && !data) {
        const variant = error instanceof NetworkTaggedError ? error.variant : 'default';
        const copy = getNetworkErrorCopy(variant);
        return <ErrorState variant={variant} title={copy.title} message={copy.message} onRetry={() => mutate()} />;
    }

    if (!data) {
        return (
            <div className={styles.page}>
                <Skeleton height={140} />
                <Skeleton height={320} />
            </div>
        );
    }

    const { pipeline, codeScanning, dependabot, deliveries, qualityGate, site } = data;
    const cluster = live?.cluster;
    const platform = cluster?.ok && cluster.data.platform.ok ? cluster.data.platform.data : null;
    const run = pipeline.ok ? pipeline.data : null;
    const released = deliveries.ok && run ? deliveries.data.find((delivery) => delivery.sha === run.commit.sha) : undefined;
    const newest = (environments: (environment: string) => boolean) => deliveries.ok
        ? [...deliveries.data].filter((delivery) => environments(delivery.environment)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
        : undefined;
    const jenkinsDelivery = newest((environment) => JENKINS_ENVIRONMENTS.has(environment));
    const vercelProduction = newest((environment) => environment === 'Production');
    const tools = codeScanning.ok ? codeScanning.data.tools : {};
    const demoUrl = site ? `${site}/scale` : null;

    return (
        <div className={styles.page}>
            <PageIntro
                eyebrow="Operations"
                title="SplitX, live"
                subtitle="Every number is read from its source as the page refreshes: the pipeline every 15 seconds, the cluster every 5. Where a source can't be read, it says so."
            />

            <div className={styles.grid}>
                <Card title="The release on main">
                    {run ? (
                        <div className={styles.release}>
                            <span className={styles.commit}>
                                <span className={styles.sha}>{run.commit.sha.slice(0, 7)}</span>
                                <span className={styles.message}>{run.commit.message}</span>
                            </span>
                            <span className={styles.tags}>
                                <Tag tone={toneOf(run.conclusion ?? run.status)}>CI {label(run.conclusion ?? run.status)}</Tag>
                                {run.release ? (
                                    <>
                                        <Tag tone={run.release.scanned ? 'success' : 'danger'}>{run.release.scanned ? 'scanned: no fixable critical or high' : 'scan gate not passed'}</Tag>
                                        <Tag tone={run.release.signed ? 'success' : 'danger'}>{run.release.signed ? 'signed (cosign, keyless)' : 'not signed'}</Tag>
                                        <Tag tone={run.release.attested ? 'success' : 'danger'}>{run.release.attested ? 'SBOM and vulnerabilities attested' : 'not attested'}</Tag>
                                    </>
                                ) : (
                                    <Tag>no release for this run</Tag>
                                )}
                            </span>
                            {released?.image && <span className={styles.digest}>{released.image}</span>}
                            <span className={styles.meta}>
                                started {timeAgo(run.startedAt)} · <a className={styles.link} href={run.url} target="_blank" rel="noreferrer">open the run</a>
                            </span>
                        </div>
                    ) : (
                        <Unavailable reading={pipeline} />
                    )}
                    <Source reading={pipeline} />
                </Card>

                <Card title="Join the demo">
                    {demoUrl ? (
                        <div className={styles.qr}>
                            <div className={styles.qrCode}>
                                <QRCodeSVG value={demoUrl} size={148} />
                            </div>
                            <span className={styles.qrCaption}>{demoUrl}</span>
                        </div>
                    ) : (
                        <p className={styles.unavailable}>This deployment doesn&apos;t know its public address (NEXTAUTH_URL).</p>
                    )}
                </Card>
            </div>

            <Section title="Tools" subtitle="Each tool's latest verdict, from the tool itself.">
                <ListGroup>
                    <ListRow
                        leading={<IconTile tone="accent"><Workflow size={18} /></IconTile>}
                        title="GitHub Actions"
                        subtitle="Tests, the real database, the image, the release"
                        trailing={<Tag tone={toneOf(run?.conclusion ?? run?.status)}>{run ? label(run.conclusion ?? run.status) : 'unavailable'}</Tag>}
                    />
                    <ListRow
                        leading={<IconTile tone="accent"><ShieldCheck size={18} /></IconTile>}
                        title="CodeQL"
                        subtitle={codeScanning.ok && codeScanning.data.lastScan ? `last scan ${label(codeScanning.data.lastScan.conclusion)}, ${timeAgo(codeScanning.data.lastScan.at)}` : 'the code and the workflows'}
                        trailing={codeScanning.ok ? <Counts counts={tools.CodeQL ?? { total: 0, bySeverity: {} }} capped={codeScanning.data.capped} /> : <Tag>unavailable</Tag>}
                    />
                    <ListRow
                        leading={<IconTile tone="accent"><PackageCheck size={18} /></IconTile>}
                        title="Trivy"
                        subtitle="Vulnerabilities in the released image"
                        trailing={codeScanning.ok ? <Counts counts={tools.Trivy ?? { total: 0, bySeverity: {} }} capped={codeScanning.data.capped} /> : <Tag>unavailable</Tag>}
                    />
                    <ListRow
                        leading={<IconTile tone="accent"><GitBranch size={18} /></IconTile>}
                        title="Dependabot"
                        subtitle="Known vulnerabilities in the dependencies"
                        trailing={dependabot.ok ? <Counts counts={dependabot.data} capped={dependabot.data.capped} /> : <Tag>unavailable</Tag>}
                    />
                    <ListRow
                        leading={<IconTile tone="accent"><ShieldCheck size={18} /></IconTile>}
                        title="SonarQube Cloud"
                        subtitle="The quality gate on main"
                        trailing={qualityGate.ok ? <Tag tone={toneOf(qualityGate.data.status)}>{qualityGate.data.status === 'OK' ? 'gate passed' : `gate ${qualityGate.data.status.toLowerCase()}`}</Tag> : <Tag>unavailable</Tag>}
                    />
                    <ListRow
                        leading={<IconTile tone="accent"><Rocket size={18} /></IconTile>}
                        title="Jenkins"
                        subtitle={jenkinsDelivery ? `deploys signed releases to ${jenkinsDelivery.environment}` : 'deploys signed releases to the cluster'}
                        trailing={jenkinsDelivery ? <Tag tone={toneOf(jenkinsDelivery.state)}>{label(jenkinsDelivery.state)}</Tag> : <Tag>unavailable</Tag>}
                    />
                    <ListRow
                        leading={<IconTile tone="accent"><Rocket size={18} /></IconTile>}
                        title="Vercel"
                        subtitle={vercelProduction ? `Production, ${vercelProduction.sha.slice(0, 7)}` : 'deploys every push to main'}
                        trailing={vercelProduction ? <Tag tone={toneOf(vercelProduction.state)}>{label(vercelProduction.state)}</Tag> : <Tag>unavailable</Tag>}
                    />
                    <ListRow
                        leading={<IconTile tone="neutral"><Boxes size={18} /></IconTile>}
                        title="Kubernetes, Prometheus, Grafana, Loki, Kyverno"
                        subtitle={platform ? `The platform, on ${platform.target === 'eks' ? 'Amazon EKS' : platform.target === 'kind' ? 'Kind' : platform.target}` : 'The platform'}
                        trailing={cluster?.ok ? <Tag tone="success">connected</Tag> : <Tag>not connected here</Tag>}
                    />
                </ListGroup>
                {[codeScanning, dependabot, qualityGate].filter((reading) => !reading.ok).map((reading) => (
                    <p key={reading.source} className={styles.meta}>{reading.source}: {reading.ok ? '' : reading.error}.</p>
                ))}
            </Section>

            <Section title="Pipeline" subtitle={run ? `The jobs of ${run.commit.sha.slice(0, 7)}` : undefined}>
                {run ? (
                    <ListGroup>
                        {run.jobs.map((job) => (
                            <ListRow
                                key={job.name}
                                title={job.name}
                                trailing={<Tag tone={toneOf(job.conclusion ?? job.status)}>{label(job.conclusion ?? job.status)}</Tag>}
                                trailingSub={duration(job.seconds)}
                            />
                        ))}
                    </ListGroup>
                ) : (
                    <Unavailable reading={pipeline} />
                )}
                <Source reading={pipeline} />
            </Section>

            <Section title="Deliveries" subtitle="Each environment's newest deployment, and what its deployer reported.">
                {deliveries.ok ? (
                    deliveries.data.length > 0 ? (
                        <ListGroup>
                            {deliveries.data.map((delivery) => (
                                <ListRow
                                    key={delivery.environment}
                                    title={`${delivery.environment} (${deployer(delivery.environment)})`}
                                    subtitle={<span className={styles.mono}>{delivery.sha.slice(0, 7)} · {delivery.image?.split('@')[1]?.slice(0, 19) ?? 'no image'}</span>}
                                    meta={delivery.description ?? undefined}
                                    trailing={<Tag tone={toneOf(delivery.state)}>{label(delivery.state)}</Tag>}
                                    trailingSub={timeAgo(delivery.reportedAt ?? delivery.createdAt)}
                                />
                            ))}
                        </ListGroup>
                    ) : (
                        <p className={styles.unavailable}>No deployment yet.</p>
                    )
                ) : (
                    <Unavailable reading={deliveries} />
                )}
                <Source reading={deliveries} />
            </Section>

            <ClusterPanels reading={cluster} onChanged={() => refreshCluster()} />

            <p className={styles.meta}>
                <a className={styles.link} href={`${REPOSITORY_URL}/security`} target="_blank" rel="noreferrer">Security tab</a>
                {' · '}
                <a className={styles.link} href={`${REPOSITORY_URL}/actions`} target="_blank" rel="noreferrer">All runs</a>
                {' · '}
                <a className={styles.link} href={`${REPOSITORY_URL}/deployments`} target="_blank" rel="noreferrer">Deployments</a>
            </p>
        </div>
    );
}
