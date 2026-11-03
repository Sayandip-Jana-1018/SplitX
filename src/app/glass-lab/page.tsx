import type { Metadata } from 'next';
import GlassLab from './GlassLab';

export const metadata: Metadata = {
    title: 'Glass lab',
    robots: { index: false, follow: false },
};

/**
 * /glass-lab: where the glass engine is proven on real phones, on Home's real
 * layout with made-up numbers. Public and needs no database, so a phone on the
 * same Wi-Fi can open it. It lives only on the feat/liquid-glass branch and is
 * removed before that branch reaches main (docs/web/LIQUID_GLASS_OVERHAUL.md, Phase 9).
 */
export default function GlassLabPage() {
    return <GlassLab />;
}
