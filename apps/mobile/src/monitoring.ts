/**
 * Crash and error reporting (Phase 3), to Sentry's free plan: project splitit-app in the
 * amazon-h6 organization. The DSN below is Sentry's public client key, made to ship inside apps.
 *
 * Errors only: no session replays, no performance tracing, no personal data (sendDefaultPii off;
 * an account is known by its id alone, never its name or email). Off while developing, so only
 * the installed app reports.
 */
import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';

const DSN = 'https://6ba592a3964458dc51345ac9c5cae470@o4511078216564736.ingest.us.sentry.io/4512434359369728';

export function startMonitoring() {
    Sentry.init({
        dsn: DSN,
        enabled: !__DEV__,
        environment: __DEV__ ? 'development' : 'production',
        release: `splitit@${Constants.expoConfig?.version ?? '0'}+${Constants.expoConfig?.android?.versionCode ?? '0'}`,
        sendDefaultPii: false,
        tracesSampleRate: 0,
        attachScreenshot: false,
        // Whatever an error carries along, nothing that names a person goes: no request bodies,
        // and breadcrumbs keep their category and level but lose free text that could hold a name.
        beforeBreadcrumb: (crumb) => (crumb.category === 'console' ? null : { ...crumb, data: undefined }),
    });
}

/** Which account an error happened in: its id only. Null when signed out or in the demo. */
export function identify(userId: string | null) {
    Sentry.setUser(userId ? { id: userId } : null);
}

/** An error a screen caught (the root error boundary) rather than one that went unhandled. */
export function reportError(error: unknown) {
    Sentry.captureException(error);
}

export const wrapRoot = Sentry.wrap;
