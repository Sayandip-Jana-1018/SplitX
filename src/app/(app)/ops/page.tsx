'use client';

import useSWR from 'swr';
import ErrorState from '@/components/ui/ErrorState';
import Skeleton from '@/components/ui/Skeleton';
import { PageIntro } from '@/components/ui/kit';
import type { ClusterReadings } from '@/lib/ops/cluster';
import type { Reading } from '@/lib/ops/reading';
import { getNetworkErrorCopy, NetworkTaggedError } from '@/lib/networkErrors';
import { fetcher } from '@/lib/swr';
import ClusterPanels from './ClusterPanels';
import { OutLink, REPOSITORY_URL } from './parts';
import { PreflightSection } from './PreflightSection';
import { DeliveriesSection, JoinCard, PipelineSection, ReleaseCard, ToolsSection, type OpsSummary } from './SummaryPanels';
import styles from './ops.module.css';

export default function OpsPage() {
    const { data, error, mutate } = useSWR<OpsSummary>('/api/ops/summary', fetcher, { refreshInterval: 15_000 });
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

    const cluster = live?.cluster;

    return (
        <div className={styles.page}>
            <PageIntro
                eyebrow="Operations"
                title="SplitX, live"
                subtitle="Every number is read from its source as the page refreshes: the pipeline every 15 seconds, the cluster every 5. Where a source can't be read, it says so."
            />

            <PreflightSection summary={data} cluster={cluster} />

            <div className={styles.grid}>
                <ReleaseCard pipeline={data.pipeline} deliveries={data.deliveries} />
                <JoinCard site={data.site} />
            </div>

            <ToolsSection summary={data} cluster={cluster} />
            <PipelineSection pipeline={data.pipeline} />
            <DeliveriesSection deliveries={data.deliveries} />
            <ClusterPanels reading={cluster} onChanged={() => refreshCluster()} />

            <nav className={styles.outLinks} aria-label="The tools themselves">
                <OutLink href={`${REPOSITORY_URL}/security`}>Security tab</OutLink>
                <OutLink href={`${REPOSITORY_URL}/actions`}>All runs</OutLink>
                <OutLink href={`${REPOSITORY_URL}/deployments`}>Deployments</OutLink>
                {data.qualityGate.ok ? <OutLink href={data.qualityGate.data.url}>SonarQube Cloud</OutLink> : null}
            </nav>
        </div>
    );
}
