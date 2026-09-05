// QC workspace (QC-CHANGES.md) — department-gated top-level route with two project-scoped tabs
// (Test Certificates + Documents), rendered by one client workspace component.
import { redirect } from 'next/navigation';
import { getFreshSessionUser, canAccessDepartment, roleHome } from '@/lib/auth';
import { canPerformAction } from '@/lib/action-permissions';
import { getTestCertificates, getAllQcDocuments, getActiveProjectsList, getCalibrationItems, getReceivedProjectIds, getNcrs, getQcHoldPoints } from '@/lib/data';
import QcWorkspace from '@/components/QcWorkspace';

export const dynamic = 'force-dynamic';

export default async function QcPage({ searchParams }) {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'QC')) redirect(roleHome(user));

  const sp = await searchParams;
  const [allProjects, certificates, documents, calibrationItems, receivedIds, ncrs, holdPoints, canDisposition, canVerify, canClose] = await Promise.all([
    // QC is the one deliberate exception to getActiveProjectsList()'s master-only default — real QC
    // documents are created per split-child unit, so QC's own picker needs children visible.
    getActiveProjectsList({ includeChildren: true }),
    getTestCertificates(),
    getAllQcDocuments(),
    getCalibrationItems(), // STERP items 34/35, §5p — not project-scoped, so not filtered below
    getReceivedProjectIds(),
    getNcrs(),
    getQcHoldPoints(),
    canPerformAction(user, 'QC', 'qc.ncr.disposition'),
    canPerformAction(user, 'QC', 'qc.ncr.verify'),
    canPerformAction(user, 'QC', 'qc.ncr.close'),
  ]);

  // A project is QC's business once Stores starts receiving its materials — filter the project
  // picker to those, unioned with any project already in the cert/doc bank so nothing worked-on
  // ever disappears. ponytail: pre-staging a doc for a project not yet receiving isn't supported;
  // widen this set if that need shows up.
  const relevant = new Set(receivedIds);
  // A split child never carries its own bom_items (all real material lives on the master), so
  // getReceivedProjectIds() can only ever see the master directly — without this, a unit stayed
  // invisible here until QC had already created a document for it via the master's batch panel.
  // Once the master is relevant, every one of its children is too, so QC can find a unit before
  // ever touching the batch-create action.
  for (const p of allProjects) {
    if (p.master_project_id && relevant.has(p.master_project_id)) relevant.add(p.id);
  }
  for (const c of certificates) String(c.project_ids || '').split(',').filter(Boolean).forEach(id => relevant.add(Number(id)));
  for (const d of documents) if (d.project_id != null) relevant.add(d.project_id);
  const projects = allProjects.filter(p => relevant.has(p.id));

  return <QcWorkspace projects={projects} certificates={certificates} documents={documents}
    calibrationItems={calibrationItems} ncrs={ncrs} holdPoints={holdPoints}
    canDisposition={canDisposition} canVerify={canVerify} canClose={canClose}
    initialTab={sp?.tab} initialProject={sp?.project} />;
}
