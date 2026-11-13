/**
 * Shader uniforms as the flat list of numbers Skia takes (`makeShader`), so a glass layer can hand
 * a shader its numbers directly each frame instead of an object Skia has to take apart by name.
 */
import type { SkRuntimeEffect } from '@shopify/react-native-skia';

/** Where each uniform starts in the flat list, and how many numbers it takes. */
export interface UniformLayout {
    size: number;
    slots: Record<string, { slot: number; count: number }>;
}

export function layoutOf(effect: SkRuntimeEffect): UniformLayout {
    const entries: { name: string; slot: number }[] = [];
    for (let i = 0; i < effect.getUniformCount(); i++) entries.push({ name: effect.getUniformName(i), slot: effect.getUniform(i).slot });
    entries.sort((a, b) => a.slot - b.slot);
    const size = effect.getUniformFloatCount();
    const slots: UniformLayout['slots'] = {};
    entries.forEach((entry, index) => {
        slots[entry.name] = { slot: entry.slot, count: (entries[index + 1]?.slot ?? size) - entry.slot };
    });
    return { size, slots };
}

type UniformValue = number | readonly number[] | readonly (readonly number[])[];

/** Writes named values into `out` at their slots; names the shader doesn't have are skipped. */
export function pack(layout: UniformLayout, values: Record<string, UniformValue>, out: number[]): void {
    'worklet';
    for (const name in values) {
        const at = layout.slots[name];
        if (!at) continue;
        const value = values[name];
        if (typeof value === 'number') {
            out[at.slot] = value;
            continue;
        }
        let i = at.slot;
        for (const item of value) {
            if (typeof item === 'number') out[i++] = item;
            else for (const part of item) out[i++] = part;
        }
    }
}

/** The slots a set of names covers, for copying just those numbers from one list into another. */
export function slotsOf(layout: UniformLayout, names: readonly string[]): number[] {
    const out: number[] = [];
    for (const name of names) {
        const at = layout.slots[name];
        if (at) for (let i = 0; i < at.count; i++) out.push(at.slot + i);
    }
    return out;
}
