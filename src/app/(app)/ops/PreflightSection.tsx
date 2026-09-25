'use client';

import type { ReactNode } from 'react';
import { CheckCircle2, Clock, MinusCircle, XCircle } from 'lucide-react';
import { IconTile, ListGroup, ListRow, Section, Tag } from '@/components/ui/kit';
import type { ClusterReadings } from '@/lib/ops/cluster';
import { preflight, preflightHeadline, type Readiness } from '@/lib/ops/preflight';
import type { Reading } from '@/lib/ops/reading';
import type { OpsSummary } from './SummaryPanels';

/*
 * Pre-flight (plan Phase 9, docs/DEMO_DAY.md): before the demo, every tool
 * green, or a red item that says what to fix. Each item is a verdict on the
 * readings the rest of the page shows (src/lib/ops/preflight.ts), so it can't
 * disagree with them.
 */

const LOOK: Record<Readiness, { tone: 'success' | 'danger' | 'warning' | 'neutral'; label: string; icon: ReactNode }> = {
    go: { tone: 'success', label: 'ready', icon: <CheckCircle2 size={18} aria-hidden /> },
    fix: { tone: 'danger', label: 'fix', icon: <XCircle size={18} aria-hidden /> },
    wait: { tone: 'warning', label: 'waiting', icon: <Clock size={18} aria-hidden /> },
    elsewhere: { tone: 'neutral', label: 'not here', icon: <MinusCircle size={18} aria-hidden /> },
};

export function PreflightSection({ summary, cluster }: Readonly<{ summary: OpsSummary; cluster: Reading<ClusterReadings> | undefined }>) {
    const items = preflight({ ...summary, cluster });
    return (
        <Section centered title="Pre-flight" subtitle={preflightHeadline(items)}>
            <ListGroup>
                {items.map((entry) => {
                    const look = LOOK[entry.readiness];
                    return (
                        <ListRow
                            key={entry.key}
                            wrap
                            leading={<IconTile tone={look.tone}>{look.icon}</IconTile>}
                            title={entry.title}
                            subtitle={entry.detail}
                            trailing={<Tag tone={look.tone}>{look.label}</Tag>}
                        />
                    );
                })}
            </ListGroup>
        </Section>
    );
}
