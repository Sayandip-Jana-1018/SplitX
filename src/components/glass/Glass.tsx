'use client';

import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react';
import type { GlassKind } from '@/lib/glass/styles';

type GlassProps<T extends ElementType> = {
    as?: T;
    kind?: GlassKind;
    /**
     * For anything that does not scroll with the page: fixed to the screen, or inside
     * a scroller of its own. The canvas moves with the page, so it would trail them.
     */
    floats?: boolean;
    children?: ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, 'as' | 'kind' | 'floats' | 'children'>;

/** A surface of glass. Ordinary markup: the engine finds it by `data-glass`, and glass.css draws it without the engine. */
export function Glass<T extends ElementType = 'div'>({ as, kind = 'reg', floats = false, children, ...rest }: GlassProps<T>) {
    const Tag: ElementType = as ?? 'div';
    return (
        <Tag {...rest} data-glass={kind} data-glass-mode={floats ? 'css' : undefined}>
            {children}
        </Tag>
    );
}
