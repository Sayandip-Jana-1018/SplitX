'use client';

import { useState, type ReactNode } from 'react';
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Boxes } from 'lucide-react';
import Button from '@/components/ui/Button';
import { IconTile, ListGroup, ListRow, Section, Segmented, StatTile, Tag, type Tone } from '@/components/ui/kit';
import type { Chart, ClusterReadings, LabRun } from '@/lib/ops/cluster';
import { platformLabel, sentence, uniqueKeys } from '@/lib/ops/present';
import type { Reading } from '@/lib/ops/reading';
import { timeAgo } from '@/lib/utils';
import { CodeLink, Footnote, SEP, Source, Unavailable } from './parts';
import styles from './ops.module.css';

/*
 * The cluster half of /ops (D-097, D-098): what ops-api read inside the
 * cluster a few seconds ago. Every panel says where its numbers came from and
 * when, links to the code that produces them, and says "unavailable" (with
 * the reason) rather than showing anything it could not read.
 *
 * Charts: one validated pair of series colours, the same in every accent
 * (ops.module.css, --ops-series-1/2, both themes); thin lines, a light wash, a
 * crosshair tooltip, and a table under each chart with the latest points.
 */

const SERIES_1 = 'var(--ops-series-1)';
const SERIES_2 = 'var(--ops-series-2)';
const INK_MUTED = 'var(--fg-tertiary)';
const HAIRLINE = 'var(--border-default)';

const hhmm = (seconds: number) => new Date(seconds * 1000).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
const hhmmss = (seconds: number) => new Date(seconds * 1000).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** A value in its unit, the way a person reads it. */
function formatValue(unit: string, value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    switch (unit) {
        case 'req/s':
            return `${value < 10 ? value.toFixed(1) : Math.round(value).toLocaleString('en-IN')} req/s`;
        case 's':
            return value < 1 ? `${Math.round(value * 1000)} ms` : `${value.toFixed(2)} s`;
        case 'ratio':
            return `${(value * 100).toFixed(value > 0 && value < 0.01 ? 2 : 1)} %`;
        case 'pods':
            return `${Math.round(value)}`;
        default:
            return String(value);
    }
}

/** Axis ticks: short, clean numbers. */
function axisValue(unit: string, value: number): string {
    if (unit === 's') return value < 1 ? `${Math.round(value * 1000)}ms` : `${value}s`;
    if (unit === 'ratio') return `${Number((value * 100).toFixed(1))}%`;
    return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
}

/**
 * The value axis runs from 0 to the data's peak. A share of requests has a
 * floor on that peak, 5 %, so a healthy line at 0 errors sits on a 0–5 %
 * scale rather than one recharts invents for an all-zero series.
 */
const RATIO_DOMAIN: [number, (peak: number) => number] = [0, (peak) => Math.max(peak, 0.05)];

const latest = (points: [number, number | null][]) => [...points].reverse().find(([, value]) => value !== null)?.[1] ?? null;

interface TooltipRow {
    name: string;
    color: string;
    unit: string;
}

/** One readout for every series at the pointer's time: the value first, then its name. */
function ChartTooltip({ active, label, payload, rows }: Readonly<{
    active?: boolean;
    label?: number;
    payload?: { dataKey?: string | number; value?: number | null }[];
    rows: Record<string, TooltipRow>;
}>) {
    if (!active || !payload?.length || label === undefined) return null;
    return (
        <output className={styles.tooltip}>
            <span className={styles.tooltipTime}>{hhmmss(label)}</span>
            {payload.map((entry) => {
                const row = rows[String(entry.dataKey)];
                if (!row) return null;
                return (
                    <span key={String(entry.dataKey)} className={styles.tooltipRow}>
                        <span className={styles.lineKey} style={{ background: row.color }} aria-hidden />
                        <strong className={styles.tooltipValue}>{formatValue(row.unit, entry.value ?? null)}</strong>
                        <span className={styles.tooltipName}>{row.name}</span>
                    </span>
                );
            })}
        </output>
    );
}

/** The table twin of a chart: the latest points, readable without hovering or colour. */
function TableView({ columns, rows }: Readonly<{ columns: string[]; rows: (string | number)[][] }>) {
    return (
        <details className={styles.tableView}>
            <summary>Table</summary>
            <table>
                <thead>
                    <tr>{columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr>
                </thead>
                <tbody>
                    {rows.map((row) => (
                        <tr key={String(row[0])}>{row.map((cell, column) => <td key={columns[column]}>{cell}</td>)}</tr>
                    ))}
                </tbody>
            </table>
        </details>
    );
}

const axisProps = {
    tick: { fill: INK_MUTED, fontSize: 11 },
    tickLine: false,
} as const;

function TimeChart({ chart }: Readonly<{ chart: Chart }>) {
    const data = chart.points.map(([time, value]) => ({ time, value }));
    const rows = { value: { name: chart.title, color: SERIES_1, unit: chart.unit } };
    return (
        <figure className={styles.chart}>
            <figcaption className={styles.chartHead}>
                <span className={styles.chartTitle}>{chart.title}</span>
                <span className={styles.chartNow}>{formatValue(chart.unit, latest(chart.points))}</span>
            </figcaption>
            <div className={styles.chartPlot}>
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
                        <CartesianGrid vertical={false} stroke={HAIRLINE} />
                        <XAxis dataKey="time" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={hhmm} minTickGap={48} axisLine={{ stroke: HAIRLINE }} {...axisProps} />
                        <YAxis
                            domain={chart.unit === 'ratio' ? RATIO_DOMAIN : [0, 'auto']}
                            tickCount={chart.unit === 'ratio' ? 6 : 5}
                            interval={0}
                            tickFormatter={(value: number) => axisValue(chart.unit, value)}
                            width={44}
                            axisLine={false}
                            allowDecimals={chart.unit !== 'pods'}
                            {...axisProps}
                        />
                        <Tooltip content={<ChartTooltip rows={rows} />} cursor={{ stroke: INK_MUTED, strokeWidth: 1 }} isAnimationActive={false} />
                        <Area
                            type="monotone"
                            dataKey="value"
                            stroke={SERIES_1}
                            strokeWidth={2}
                            fill={SERIES_1}
                            fillOpacity={0.1}
                            dot={false}
                            activeDot={{ r: 4, fill: SERIES_1, stroke: 'var(--surface-card)', strokeWidth: 2 }}
                            isAnimationActive={false}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
            <TableView
                columns={['Time', chart.title]}
                rows={chart.points.slice(-8).reverse().map(([time, value]) => [hhmmss(time), formatValue(chart.unit, value)])}
            />
            <span className={styles.chartNote}>The query of Grafana&apos;s &ldquo;{chart.panel}&rdquo; panel</span>
        </figure>
    );
}

/** Ready pods and the autoscaler's wish, on one axis: both are pod counts. */
function PodsChart({ ready, wanted }: Readonly<{ ready: Chart; wanted: Chart }>) {
    const wantedAt = new Map(wanted.points.map(([time, value]) => [time, value]));
    const data = ready.points.map(([time, value]) => ({ time, ready: value, wanted: wantedAt.get(time) ?? null }));
    const rows = {
        ready: { name: ready.title, color: SERIES_1, unit: 'pods' },
        wanted: { name: wanted.title, color: SERIES_2, unit: 'pods' },
    };
    return (
        <figure className={styles.chart}>
            <figcaption className={styles.chartHead}>
                <span className={styles.chartTitle}>Pods</span>
                {/* The legend, and each line's value now: the chart's direct labels. */}
                <span className={styles.legend}>
                    <span className={styles.legendItem}>
                        <span className={styles.lineKey} style={{ background: SERIES_1 }} aria-hidden />
                        {ready.title} <strong>{formatValue('pods', latest(ready.points))}</strong>
                    </span>
                    <span className={styles.legendItem}>
                        <span className={styles.lineKey} style={{ background: SERIES_2 }} aria-hidden />
                        {wanted.title} <strong>{formatValue('pods', latest(wanted.points))}</strong>
                    </span>
                </span>
            </figcaption>
            <div className={styles.chartPlot}>
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
                        <CartesianGrid vertical={false} stroke={HAIRLINE} />
                        <XAxis dataKey="time" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={hhmm} minTickGap={48} axisLine={{ stroke: HAIRLINE }} {...axisProps} />
                        <YAxis domain={[0, 'auto']} allowDecimals={false} interval={0} width={44} axisLine={false} {...axisProps} />
                        <Tooltip content={<ChartTooltip rows={rows} />} cursor={{ stroke: INK_MUTED, strokeWidth: 1 }} isAnimationActive={false} />
                        <Line type="stepAfter" dataKey="wanted" stroke={SERIES_2} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: SERIES_2, stroke: 'var(--surface-card)', strokeWidth: 2 }} isAnimationActive={false} />
                        <Line type="stepAfter" dataKey="ready" stroke={SERIES_1} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: SERIES_1, stroke: 'var(--surface-card)', strokeWidth: 2 }} isAnimationActive={false} />
                    </LineChart>
                </ResponsiveContainer>
            </div>
            <TableView
                columns={['Time', ready.title, wanted.title]}
                rows={data.slice(-8).reverse().map((point) => [hhmmss(point.time), formatValue('pods', point.ready), formatValue('pods', point.wanted)])}
            />
            <span className={styles.chartNote}>The queries of Grafana&apos;s &ldquo;{ready.panel}&rdquo; and &ldquo;{wanted.panel}&rdquo; panels</span>
        </figure>
    );
}

function Panel({ title, reading, code, children }: Readonly<{ title: string; reading: Reading<unknown>; code: string; children: ReactNode }>) {
    return (
        <div className={styles.card}>
            <span className={styles.cardTitle}>{title}</span>
            {reading.ok ? children : <Unavailable reading={reading} />}
            <Footnote>
                <Source reading={reading} />{SEP}<CodeLink path={code} />
            </Footnote>
        </div>
    );
}

/** A stat tile with its label, value and hint centred, as in every /ops panel. */
function Stat(props: Readonly<Parameters<typeof StatTile>[0]>) {
    return <StatTile {...props} className={styles.stat} />;
}

const RATES = [
    { value: '10', label: '10 / s' },
    { value: '20', label: '20 / s' },
    { value: '30', label: '30 / s' },
] as const;
const DURATIONS = [
    { value: '60', label: '1 min' },
    { value: '120', label: '2 min' },
    { value: '180', label: '3 min' },
] as const;

const LAB_TONES = new Map<LabRun['state'], Tone>([
    ['running', 'warning'],
    ['stopping', 'warning'],
    ['failed', 'danger'],
    ['finished', 'success'],
]);

function LabResult({ run }: Readonly<{ run: LabRun }>) {
    const going = run.state === 'running' || run.state === 'stopping';
    return (
        <span className={styles.tags}>
            <Tag tone={LAB_TONES.get(run.state) ?? 'neutral'}>{run.state}</Tag>
            {going && run.rate && run.seconds ? <Tag>{run.rate} a second · {run.elapsedSeconds ?? 0} of {run.seconds} s</Tag> : null}
            {!going && run.summary ? (
                <Tag tone={run.summary.failed > 0 ? 'danger' : 'success'}>
                    {run.summary.served.toLocaleString('en-IN')} served · {run.summary.refused} refused on purpose · {run.summary.failed} failed · p95 {run.summary.p95Ms ?? '—'} ms
                </Tag>
            ) : null}
        </span>
    );
}

function TrafficLab({ lab, onChanged }: Readonly<{ lab: Reading<LabRun>; onChanged: () => void }>) {
    const [rate, setRate] = useState<(typeof RATES)[number]['value']>('20');
    const [seconds, setSeconds] = useState<(typeof DURATIONS)[number]['value']>('120');
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);
    const run = lab.ok ? lab.data : null;
    const going = run?.state === 'running' || run?.state === 'stopping';

    async function ask(method: 'POST' | 'DELETE') {
        setBusy(true);
        setProblem(null);
        try {
            const response = await fetch('/api/ops/traffic', {
                method,
                headers: method === 'POST' ? { 'content-type': 'application/json' } : undefined,
                body: method === 'POST' ? JSON.stringify({ rate: Number(rate), seconds: Number(seconds) }) : undefined,
            });
            if (!response.ok) {
                const body = (await response.json().catch(() => ({}))) as { error?: string };
                setProblem(body.error ?? `The lab answered ${response.status}.`);
            }
        } catch {
            setProblem('The request did not reach SplitX.');
        } finally {
            setBusy(false);
            onChanged();
        }
    }

    return (
        <div className={styles.card}>
            <span className={styles.cardTitle}>Traffic lab</span>
            {run ? (
                <>
                    <p className={styles.lede}>
                        Real settlement plans for 1,000-person trips, sent to {run.target} at a steady rate, the way visitors
                        arrive: watch the autoscaler add pods, and then take them away. At most 30 a second for 3 minutes.
                    </p>
                    <div className={styles.labControls}>
                        <Segmented options={[...RATES]} value={rate} onChange={setRate} size="sm" ariaLabel="Plans per second" />
                        <Segmented options={[...DURATIONS]} value={seconds} onChange={setSeconds} size="sm" ariaLabel="How long" />
                        {going ? (
                            <Button variant="danger" fullWidth loading={busy} disabled={busy || run.state === 'stopping'} onClick={() => ask('DELETE')}>
                                Stop
                            </Button>
                        ) : (
                            <Button variant="primary" fullWidth loading={busy} disabled={busy} onClick={() => ask('POST')}>
                                Start
                            </Button>
                        )}
                    </div>
                    <LabResult run={run} />
                    {run.error ? <p className={styles.lede}>{run.error}</p> : null}
                    {problem ? <p className={styles.lede}>{problem}</p> : null}
                </>
            ) : (
                <Unavailable reading={lab} />
            )}
            <Footnote>
                <Source reading={lab} />{SEP}<CodeLink path="ops/lab/server.mjs" />{SEP}<CodeLink path="ops/lab/limits.mjs">its limits</CodeLink>
            </Footnote>
        </div>
    );
}

const SEVERITY_TONES = new Map<string, Tone>([
    ['critical', 'danger'],
    ['warning', 'warning'],
]);
const percent = (value: number | null) => (value === null ? '—' : `${value} %`);

function money(unit: string, value: number | null): string {
    if (value === null) return '—';
    const symbol = unit === 'USD' ? '$' : `${unit} `;
    return `${symbol}${value.toFixed(2)}`;
}

function TrafficSection({ c, onChanged }: Readonly<{ c: ClusterReadings; onChanged: () => void }>) {
    const traffic = c.traffic.ok ? c.traffic.data : null;
    return (
        <Section centered title="Traffic and the autoscaler" subtitle="Live from Prometheus, read every 5 seconds: the last 15 minutes.">
            <div className={styles.grid}>
                <TrafficLab lab={c.lab} onChanged={onChanged} />
                <Panel title="Pods answering people now" reading={c.servingPods} code="ops/api/queries.mjs">
                    {c.servingPods.ok && c.servingPods.data.length > 0 ? (
                        <ListGroup className={styles.flush}>
                            {c.servingPods.data.map((pod) => (
                                <ListRow key={pod.pod} title={<span className={styles.mono}>{pod.pod}</span>} trailing={<Tag tone="accent">{formatValue('req/s', pod.rate)}</Tag>} />
                            ))}
                        </ListGroup>
                    ) : (
                        <p className={styles.empty}>No pod has answered a person in the last minute.</p>
                    )}
                </Panel>
            </div>
            {traffic ? (
                <div className={styles.charts}>
                    <TimeChart chart={traffic.charts.requests} />
                    <TimeChart chart={traffic.charts.p95} />
                    <TimeChart chart={traffic.charts.errors} />
                    <PodsChart ready={traffic.charts.readyPods} wanted={traffic.charts.wantedPods} />
                </div>
            ) : (
                <Unavailable reading={c.traffic} />
            )}
            <Footnote>
                <Source reading={c.traffic} />{SEP}<CodeLink path="ops/api/queries.mjs">the queries</CodeLink>{SEP}<CodeLink path="monitoring/dashboards/splitx-service.json">the Grafana dashboard they match</CodeLink>
            </Footnote>
        </Section>
    );
}

function ClusterSection({ c }: Readonly<{ c: ClusterReadings }>) {
    const { autoscaler, admissions } = c;
    return (
        <Section centered title="The cluster" subtitle="Nodes, the app's pods, the autoscaler, and what the admission policy let in.">
            <div className={styles.grid}>
                <Panel title="Autoscaler" reading={autoscaler} code="k8s/base/hpa.yaml">
                    {autoscaler.ok && (
                        <div className={styles.stats}>
                            <Stat label="Pods now" value={autoscaler.data.current ?? '—'} hint={`between ${autoscaler.data.min ?? '—'} and ${autoscaler.data.max ?? '—'}`} />
                            <Stat label="It wants" value={autoscaler.data.desired ?? '—'} hint={autoscaler.data.lastScaled ? `last scaled ${timeAgo(autoscaler.data.lastScaled)}` : 'not scaled yet'} />
                            <Stat label="CPU" value={percent(autoscaler.data.cpuNowPercent)} hint={`target ${percent(autoscaler.data.cpuTargetPercent)} of the request`} />
                        </div>
                    )}
                </Panel>
                <Panel title="Admission policy, last 24 hours" reading={admissions} code="policy/verify-release.yaml">
                    {admissions.ok && (
                        <div className={styles.stats}>
                            <Stat label="Allowed" value={admissions.data.allowed.toLocaleString('en-IN')} tone="success" />
                            <Stat label="Refused" value={admissions.data.refused.toLocaleString('en-IN')} tone={admissions.data.refused > 0 ? 'danger' : 'neutral'} hint="unsigned images and the like" />
                        </div>
                    )}
                </Panel>
            </div>
            <Panel title="Nodes" reading={c.nodes} code="terraform/platform/cluster.tf">
                {c.nodes.ok && (
                    <ListGroup className={styles.flush}>
                        {c.nodes.data.map((node) => (
                            <ListRow
                                key={node.name}
                                wrap
                                title={<span className={styles.mono}>{node.name}</span>}
                                subtitle={[node.zone, node.instanceType, `CPU ${percent(node.cpuPercent)}`, `memory ${percent(node.memoryPercent)}`].filter(Boolean).join(' · ')}
                                trailing={<Tag tone={node.ready ? 'success' : 'danger'}>{node.ready ? 'ready' : 'not ready'}</Tag>}
                            />
                        ))}
                    </ListGroup>
                )}
            </Panel>
            <Panel title="The app's pods" reading={c.workloads} code="k8s/base/deployment.yaml">
                {c.workloads.ok && (
                    <ListGroup className={styles.flush}>
                        {c.workloads.data.map((pod) => (
                            <ListRow
                                key={pod.name}
                                wrap
                                title={<span className={styles.mono}>{pod.name}</span>}
                                subtitle={[pod.node, pod.zone].filter(Boolean).join(' · ') || undefined}
                                meta={
                                    <span className={styles.rowNote}>
                                        {[pod.digest, `${pod.restarts} restart${pod.restarts === 1 ? '' : 's'}`, pod.since ? `started ${timeAgo(pod.since)}` : null].filter(Boolean).join(' · ')}
                                    </span>
                                }
                                trailing={<Tag tone={pod.ready ? 'success' : 'warning'}>{pod.ready ? 'ready' : pod.phase.toLowerCase()}</Tag>}
                            />
                        ))}
                    </ListGroup>
                )}
            </Panel>
        </Section>
    );
}

function lastDeployTone(result: string | null): 'success' | 'danger' | 'neutral' {
    if (!result) return 'neutral';
    return result === 'success' ? 'success' : 'danger';
}

function EvidenceSection({ c }: Readonly<{ c: ClusterReadings }>) {
    const { alerts, delivery, evidence, logs } = c;
    return (
        <Section centered title="Alerts, logs and evidence" subtitle="Alertmanager, Loki, Jenkins and Nexus, each read directly.">
            <div className={styles.grid}>
                <Panel title="Alerts firing" reading={alerts} code="k8s/base/prometheusrule.yaml">
                    {alerts.ok && alerts.data.length === 0 ? <span className={styles.tags}><Tag tone="success">none firing</Tag></span> : null}
                    {alerts.ok && alerts.data.length > 0 ? (
                        <ListGroup className={styles.flush}>
                            {alerts.data.map((alert) => (
                                <ListRow
                                    key={`${alert.name}-${alert.since}`}
                                    wrap
                                    title={alert.name}
                                    subtitle={alert.summary || undefined}
                                    trailing={<Tag tone={SEVERITY_TONES.get(alert.severity) ?? 'neutral'}>{alert.severity}</Tag>}
                                    trailingSub={alert.since ? timeAgo(alert.since) : undefined}
                                />
                            ))}
                        </ListGroup>
                    ) : null}
                </Panel>
                <Panel title="Delivery" reading={delivery} code="jenkins/deploy.mjs">
                    {delivery.ok && (
                        <div className={styles.stats}>
                            <Stat label="Jenkins' last deploy" value={delivery.data.lastResult ?? '—'} tone={lastDeployTone(delivery.data.lastResult)} />
                            <Stat label="It took" value={delivery.data.lastSeconds === null ? '—' : `${delivery.data.lastSeconds} s`} />
                        </div>
                    )}
                </Panel>
            </div>
            <Panel title="Release evidence in Nexus" reading={evidence} code="nexus/provision.mjs">
                {evidence.ok && evidence.data.length === 0 ? <p className={styles.empty}>Nothing stored yet: Jenkins archives each deployment&apos;s evidence as it deploys.</p> : null}
                {evidence.ok && evidence.data.length > 0 ? (
                    <ListGroup className={styles.flush}>
                        {evidence.data.map((entry) => (
                            <ListRow
                                key={`${entry.commit}/${entry.deployment}`}
                                wrap
                                title={<span className={styles.mono}>{entry.commit}</span>}
                                subtitle={`deployment ${entry.deployment} · ${entry.files.join(', ')}`}
                                trailing={<Tag tone={entry.complete ? 'success' : 'warning'}>{entry.complete ? 'complete' : 'incomplete'}</Tag>}
                                trailingSub={entry.storedAt ? timeAgo(entry.storedAt) : undefined}
                            />
                        ))}
                    </ListGroup>
                ) : null}
            </Panel>
            <Panel title="The app's log, newest first" reading={logs} code="src/lib/logger.ts">
                {logs.ok && logs.data.length === 0 ? <p className={styles.empty}>No log lines in the last 15 minutes.</p> : null}
                {logs.ok && logs.data.length > 0 ? (
                    <ol className={styles.logs}>
                        {uniqueKeys(logs.data.slice(0, 20), (line) => [line.time, line.pod, line.requestId, line.message].join('|')).map(([key, line]) => (
                            <li key={key}>
                                <span className={styles.logTime}>{line.time.slice(11, 19)}</span>
                                <span className={styles.logLevel}>{line.level ?? '—'}</span>
                                <span className={styles.logMessage}>{line.message}</span>
                            </li>
                        ))}
                    </ol>
                ) : null}
            </Panel>
        </Section>
    );
}

function InfrastructureSection({ c }: Readonly<{ c: ClusterReadings }>) {
    const { platform, budget, stacks, edge, eks } = c;
    const over = budget.ok && budget.data.forecast !== null && budget.data.limit !== null && budget.data.forecast > budget.data.limit;
    return (
        <Section centered title="Infrastructure" subtitle="What CloudFormation and Terraform built, read from AWS with ops-api's read-only role.">
            <div className={styles.grid}>
                <Panel title="The platform" reading={platform} code="scripts/lib/ops-platform.mjs">
                    {platform.ok && (
                        <ListGroup className={styles.flush}>
                            <ListRow title="Where" trailing={<Tag tone="accent">{platformLabel(platform.data.target)}</Tag>} trailingSub={platform.data.region ?? undefined} />
                            <ListRow title="Kubernetes" trailing={<span className={styles.mono}>{platform.data.kubernetesVersion ?? '—'}</span>} />
                            {platform.data.vpcCidr ? <ListRow title="Network" trailing={<span className={styles.mono}>{platform.data.vpcCidr}</span>} trailingSub={platform.data.serviceCidr ? `services ${platform.data.serviceCidr}` : undefined} /> : null}
                            {platform.data.edge ? <ListRow title="The edge" trailing={<span className={styles.mono}>{platform.data.edge}</span>} /> : null}
                        </ListGroup>
                    )}
                </Panel>
                <Panel title="Budget, this month" reading={budget} code="cloudformation/guardrails.yaml">
                    {budget.ok && (
                        <div className={styles.stats}>
                            <Stat label="Spent" value={money(budget.data.unit, budget.data.actual)} hint={`of ${money(budget.data.unit, budget.data.limit)}`} />
                            <Stat label="Forecast" value={money(budget.data.unit, budget.data.forecast)} tone={over ? 'danger' : 'neutral'} />
                        </div>
                    )}
                </Panel>
            </div>
            <div className={styles.grid}>
                <Panel title="CloudFormation stacks" reading={stacks} code="cloudformation/bootstrap.yaml">
                    {stacks.ok && (
                        <ListGroup className={styles.flush}>
                            {stacks.data.map((stack) => (
                                <ListRow
                                    key={stack.name}
                                    title={stack.name}
                                    subtitle={stack.drift === 'NOT_CHECKED' ? 'drift not checked yet' : `drift: ${stack.drift.toLowerCase().replaceAll('_', ' ')}`}
                                    trailing={<Tag tone={stack.status.endsWith('_COMPLETE') && !stack.status.includes('ROLLBACK') ? 'success' : 'warning'}>{stack.status.toLowerCase().replaceAll('_', ' ')}</Tag>}
                                    trailingSub={stack.updatedAt ? timeAgo(stack.updatedAt) : undefined}
                                />
                            ))}
                        </ListGroup>
                    )}
                </Panel>
                <Panel title="CloudFront" reading={edge} code="terraform/edge/main.tf">
                    {edge.ok && (
                        <ListGroup className={styles.flush}>
                            <ListRow wrap title={<span className={styles.mono}>{edge.data.domain}</span>} subtitle={`serving ${edge.data.origin}`} trailing={<Tag tone={edge.data.online ? 'success' : 'neutral'}>{edge.data.online ? 'online' : 'offline page'}</Tag>} trailingSub={edge.data.status.toLowerCase()} />
                        </ListGroup>
                    )}
                </Panel>
            </div>
            <Panel title="Amazon EKS" reading={eks} code="terraform/platform/cluster.tf">
                {eks.ok && (
                    <>
                        <ListGroup className={styles.flush}>
                            <ListRow
                                wrap
                                title={eks.data.name}
                                subtitle={[`Kubernetes ${eks.data.version}`, eks.data.platformVersion ? `(${eks.data.platformVersion})` : null, `· access ${eks.data.authenticationMode?.toLowerCase() ?? '—'}`].filter(Boolean).join(' ')}
                                trailing={<Tag tone={eks.data.status === 'ACTIVE' ? 'success' : 'warning'}>{eks.data.status.toLowerCase()}</Tag>}
                            />
                            {eks.data.nodegroups.map((group) => (
                                <ListRow key={group.name} wrap title={group.name} subtitle={`${group.instanceTypes.join(', ')} · ${group.min ?? '—'} to ${group.max ?? '—'} nodes, ${group.desired ?? '—'} wanted`} trailing={<Tag tone={group.status === 'ACTIVE' ? 'success' : 'warning'}>{group.status.toLowerCase()}</Tag>} />
                            ))}
                        </ListGroup>
                        <span className={styles.tags}>
                            {eks.data.addons.map((addon) => (
                                <Tag key={addon.name} tone={addon.status === 'ACTIVE' ? 'success' : 'warning'}>{addon.name} {addon.version}</Tag>
                            ))}
                        </span>
                    </>
                )}
            </Panel>
        </Section>
    );
}

/** No cluster to read (Vercel, or a cluster that's down): what the section would show, and why it doesn't. */
function NotConnected({ reading }: Readonly<{ reading: Extract<Reading<ClusterReadings>, { ok: false }> }>) {
    return (
        <Section centered title="Cluster and traffic lab">
            <div className={styles.emptyCard}>
                <IconTile tone="neutral" size={48}>
                    <Boxes size={22} />
                </IconTile>
                <span className={styles.emptyTitle}>The cluster isn&apos;t connected here</span>
                <p className={styles.emptyText}>
                    {sentence(reading.error)} When it is, this page shows the nodes and pods, the autoscaler, Kyverno&apos;s admissions,
                    live traffic with its latency and errors, the alerts, the logs, and the AWS stacks behind it.
                </p>
                <Footnote>
                    <Source reading={reading} />{SEP}<CodeLink path="ops/api/server.mjs">ops-api</CodeLink>
                </Footnote>
            </div>
        </Section>
    );
}

export default function ClusterPanels({ reading, onChanged }: Readonly<{ reading: Reading<ClusterReadings> | undefined; onChanged: () => void }>) {
    if (!reading) return null;
    if (!reading.ok) return <NotConnected reading={reading} />;
    return (
        <>
            <TrafficSection c={reading.data} onChanged={onChanged} />
            <ClusterSection c={reading.data} />
            <EvidenceSection c={reading.data} />
            <InfrastructureSection c={reading.data} />
        </>
    );
}
