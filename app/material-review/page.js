// Inward + Pre-Dispatch QC/Production Approval Workflow — department-gated top-level route, same
// shape as app/installation/page.js. Deliberately NOT /approvals — that's already the existing
// USB-device/browser security-approval platform (Part B of this app); a different URL to avoid the
// naming collision.
import { redirect } from 'next/navigation';
import { getFreshSessionUser, canAccessDepartment, isDepartmentHead, roleHome } from '@/lib/auth';
import { getPendingInwardApprovals, getPendingPreDispatchApprovals } from '@/lib/data';
import MaterialReviewWorkspace from '@/components/MaterialReviewWorkspace';

export const dynamic = 'force-dynamic';

export default async function MaterialReviewPage() {
  const user = await getFreshSessionUser();
  if (!['QC', 'Production', 'Dispatch'].some(d => canAccessDepartment(user, d))) redirect(roleHome(user));

  const [inward, preDispatch] = await Promise.all([
    getPendingInwardApprovals(),
    getPendingPreDispatchApprovals(),
  ]);

  // Client-side visibility only — every write route re-enforces this server-side via
  // requireAction/canPerformAction. Computed here so a Member/Dispatch viewer sees a read-only
  // queue instead of a button that would always 403.
  return <MaterialReviewWorkspace inward={inward} preDispatch={preDispatch}
    canDecideInward={isDepartmentHead(user, 'QC')}
    canDecideQc={isDepartmentHead(user, 'QC')}
    canDecideProduction={isDepartmentHead(user, 'Production')} />;
}
