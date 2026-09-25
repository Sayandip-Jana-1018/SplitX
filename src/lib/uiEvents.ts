'use client';

/**
 * Tiny app-wide UI event bus. Lets any screen open shell-level surfaces
 * (the AI assistant, the product tour) without prop-drilling through the layout.
 */
export const UI_EVENTS = {
    openAssistant: 'splitx:open-assistant',
    startTour: 'splitx:start-tour',
} as const;

export const TOUR_STORAGE_KEY = 'SplitX-tour-v2';

export function openAssistant() {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(UI_EVENTS.openAssistant));
}

/** Clears the "tour seen" flag and asks the shell to replay the walkthrough on Home. */
export function startTour() {
    if (typeof window === 'undefined') return;
    try {
        localStorage.removeItem(TOUR_STORAGE_KEY);
    } catch { /* storage unavailable */ }
    window.dispatchEvent(new CustomEvent(UI_EVENTS.startTour));
}
