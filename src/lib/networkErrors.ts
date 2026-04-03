'use client';

export type NetworkErrorVariant = 'default' | 'network' | 'restricted' | 'offline' | 'server';

export class NetworkTaggedError extends Error {
    variant: NetworkErrorVariant;

    constructor(variant: NetworkErrorVariant, message?: string) {
        super(message);
        this.variant = variant;
        this.name = 'NetworkTaggedError';
    }
}

const RESTRICTED_NETWORK_EVENT = 'splitx:network-blocked';

export function emitRestrictedNetworkSignal() {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(RESTRICTED_NETWORK_EVENT));
}

export function onRestrictedNetworkSignal(handler: () => void) {
    if (typeof window === 'undefined') return () => undefined;
    window.addEventListener(RESTRICTED_NETWORK_EVENT, handler);
    return () => window.removeEventListener(RESTRICTED_NETWORK_EVENT, handler);
}

export function classifyNetworkError(params: {
    error?: unknown;
    response?: Response | null;
}): NetworkErrorVariant {
    const { error, response } = params;

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
        return 'offline';
    }

    if (response) {
        if (response.status >= 500) return 'server';
        if (response.type === 'opaque') return 'restricted';
        if (response.status === 0) return 'restricted';
        return 'network';
    }

    if (error instanceof TypeError) {
        return 'restricted';
    }

    return 'network';
}

export function getNetworkErrorCopy(variant: NetworkErrorVariant) {
    switch (variant) {
        case 'offline':
            return {
                title: 'You are offline',
                message: 'Reconnect to the internet and try again. SplitX will be ready when your connection returns.',
            };
        case 'restricted':
            return {
                title: 'Out of network',
                message: 'This network may be blocking SplitX. Try again or switch to a different network.',
            };
        case 'server':
            return {
                title: 'Server is busy',
                message: 'Something went wrong on our end. Please try again in a moment.',
            };
        case 'network':
            return {
                title: 'Connection problem',
                message: 'We could not reach SplitX right now. Please try again.',
            };
        default:
            return {
                title: 'Something went wrong',
                message: 'We could not load the data. Please try again.',
            };
    }
}

export function toNetworkTaggedError(params: {
    error?: unknown;
    response?: Response | null;
}) {
    const variant = classifyNetworkError(params);
    if (variant === 'restricted') {
        emitRestrictedNetworkSignal();
    }

    const copy = getNetworkErrorCopy(variant);
    return new NetworkTaggedError(variant, copy.message);
}
