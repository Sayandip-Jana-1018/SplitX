import { readSource, recentReading, type Reading } from './reading';

export interface QualityGate {
    /** SonarQube Cloud's verdict: OK or ERROR. */
    status: string;
    conditions: { metric: string; status: string; actual: string | null; threshold: string | null }[];
    url: string;
}

interface ProjectStatus {
    projectStatus: {
        status: string;
        conditions?: { metricKey: string; status: string; actualValue?: string; errorThreshold?: string }[];
    };
}

/**
 * The quality gate SonarQube Cloud gave main's newest analysis (the CI job
 * `sonar` runs it). A public project's gate is readable without a token.
 */
export function readQualityGate(): Promise<Reading<QualityGate>> {
    return recentReading('sonar:gate', 60_000, () => readSource('SonarQube Cloud quality gate', async () => {
        const project = process.env.SONAR_PROJECT_KEY;
        if (!project) throw new Error('SONAR_PROJECT_KEY is not set');
        const response = await fetch(`https://sonarcloud.io/api/qualitygates/project_status?projectKey=${encodeURIComponent(project)}`, {
            cache: 'no-store',
            signal: AbortSignal.timeout(8_000),
        });
        if (!response.ok) throw new Error(`SonarQube Cloud answered ${response.status}`);
        const { projectStatus } = (await response.json()) as ProjectStatus;
        return {
            status: projectStatus.status,
            conditions: (projectStatus.conditions ?? []).map((condition) => ({
                metric: condition.metricKey,
                status: condition.status,
                actual: condition.actualValue ?? null,
                threshold: condition.errorThreshold ?? null,
            })),
            url: `https://sonarcloud.io/project/overview?id=${encodeURIComponent(project)}`,
        };
    }));
}
