'use client';

import { useEffect, useRef } from 'react';

let openDialogs = 0;
let previousOverflow = '';

export function useDialogFocus(open: boolean, onClose: () => void) {
    const ref = useRef<HTMLDivElement>(null);
    const closeRef = useRef(onClose);

    useEffect(() => { closeRef.current = onClose; }, [onClose]);

    useEffect(() => {
        if (!open) return;
        const returnTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        if (openDialogs++ === 0) {
            previousOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
        }
        const frame = requestAnimationFrame(() => ref.current?.focus());
        const handleKey = (event: KeyboardEvent) => {
            const dialogs = document.querySelectorAll('[data-focus-dialog]');
            if (dialogs[dialogs.length - 1] !== ref.current) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                closeRef.current();
            }
            if (event.key !== 'Tab' || !ref.current) return;
            const targets = Array.from(ref.current.querySelectorAll<HTMLElement>(
                'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]'
            )).filter((element) => element.getClientRects().length > 0);
            const first = targets[0];
            const last = targets[targets.length - 1];
            if (!first) { event.preventDefault(); return; }
            if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', handleKey);
        return () => {
            cancelAnimationFrame(frame);
            document.removeEventListener('keydown', handleKey);
            if (--openDialogs === 0) document.body.style.overflow = previousOverflow;
            if (returnTarget?.isConnected) returnTarget.focus();
        };
    }, [open]);

    return ref;
}
