import type { GateCondition } from './present';
import { readSource, recentReading, type Reading } from './reading';

export interface QualityGate {
    /** SonarQube Cloud's verdict: OK, ERROR, or NONE before the project has one. */
    status: string;
    conditions: GateCondition[];
    /** The newest analysis the verdict belongs to: when, and of which commit. */
    analysis: { at: string; revision: string | null } | null;
    url: string;
}

interface ProjectStatus {
    projectStatus: {
        status: string;
        conditions?: { metricKey: string; status: string; comparator?: string; actualValue?: string; errorThreshold?: string }[];
    };
}

interface ProjectAnalyses {
    analyses?: { date: string; revision?: string }[];
}

async function sonar<T>(path: string): Promise<T> {
    const response = await fetch(`https://sonarcloud.io${path}`, { cache: 'no-store', signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error(`SonarQube Cloud answered ${response.status}`);
    return (await response.json()) as T;
}

/** Sonar writes offsets as +0000; an ISO time has +00:00. */
const isoTime = (date: string) => new Date(date.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')).toISOString();

/**
 * The quality gate SonarQube Cloud gave main's newest analysis (the CI job
 * `sonar` runs it), and that analysis. A public project's gate is readable
 * without a token.
 */
export function readQualityGate(): Promise<Reading<QualityGate>> {
    return recentReading('sonar:gate', 60_000, () => readSource('SonarQube Cloud quality gate', async () => {
        const project = process.env.SONAR_PROJECT_KEY;
        if (!project) throw new Error('SONAR_PROJECT_KEY is not set');
        const key = encodeURIComponent(project);
        const [{ projectStatus }, { analyses = [] }] = await Promise.all([
            sonar<ProjectStatus>(`/api/qualitygates/project_status?projectKey=${key}`),
            sonar<ProjectAnalyses>(`/api/project_analyses/search?project=${key}&ps=1`),
        ]);
        const [newest] = analyses;
        return {
            status: projectStatus.status,
            conditions: (projectStatus.conditions ?? []).map((condition) => ({
                metric: condition.metricKey,
                status: condition.status,
                comparator: condition.comparator ?? null,
                actual: condition.actualValue ?? null,
                threshold: condition.errorThreshold ?? null,
            })),
            analysis: newest ? { at: isoTime(newest.date), revision: newest.revision ?? null } : null,
            url: `https://sonarcloud.io/summary/new_code?id=${key}`,
        };
    }));
}
