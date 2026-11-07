import { Skia, type SkRuntimeEffect } from '@shopify/react-native-skia';
import { coinSkSL, LIQUID_SKSL, SURFACE_SKSL } from './sksl';

interface Effects {
    liquid: SkRuntimeEffect;
    surface: SkRuntimeEffect;
    coin: SkRuntimeEffect;
}

let compiled: Effects | null = null;

function make(name: string, source: string): SkRuntimeEffect {
    const effect = Skia.RuntimeEffect.Make(source);
    if (!effect) throw new Error(`The ${name} shader didn't compile`);
    return effect;
}

/** Compiled once, on first use: on the web Skia has only just loaded by then. */
export function effects(): Effects {
    compiled ??= {
        liquid: make('liquid', LIQUID_SKSL),
        surface: make('glass', SURFACE_SKSL),
        coin: make('coin', coinSkSL()),
    };
    return compiled;
}
