import type { Metadata } from 'next';
import ScaleDemo from './ScaleDemo';

export const metadata: Metadata = {
    title: 'Watch it scale',
    description: 'Settle a trip for up to 2,000 people and see which server in the SplitX cluster did the work.',
};

/**
 * /scale: the page a classroom opens during the autoscaling demo.
 *
 * Public, no sign-in, built for phones. Every plan is computed live by
 * POST /api/settlements/preview, which names the pod that answered, so the
 * audience watches load spread across replicas and new pods join as the
 * autoscaler reacts to them.
 */
export default function ScalePage() {
    return <ScaleDemo />;
}
