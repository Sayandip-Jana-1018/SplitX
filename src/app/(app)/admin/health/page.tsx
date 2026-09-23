import { redirect } from 'next/navigation';

/**
 * The old health page read /api/admin/health, which never existed, so it only
 * ever showed an error. The operations page replaced it.
 */
export default function AdminHealthPage() {
    redirect('/ops');
}
