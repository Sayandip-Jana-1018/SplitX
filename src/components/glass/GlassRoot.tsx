'use client';

import { useEffect, type RefObject } from 'react';
import { createGlassEngine, type GlassEngine } from '@/lib/glass/engine';
import '@/styles/glass.css';

/** Starts the one glass engine for as long as it is on the page. Everything else stays ordinary markup. */
export function GlassRoot({ engineRef }: { engineRef?: RefObject<GlassEngine | null> }) {
    useEffect(() => {
        const engine = createGlassEngine();
        if (engineRef) engineRef.current = engine;
        return () => {
            if (engineRef) engineRef.current = null;
            engine.destroy();
        };
    }, [engineRef]);
    return null;
}
