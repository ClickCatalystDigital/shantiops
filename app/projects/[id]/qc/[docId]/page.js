// app/projects/[id]/qc/[docId]/page.js

import { notFound, redirect } from 'next/navigation';
import { queryOne } from '@/lib/db';
import { getQcDocumentDetail, getTestCertificates, getBomItemsForProject, getTcMatchApprovals, getBomAssembliesFlat } from '@/lib/data';
import { getFreshSessionUser, canAccessDepartment, roleHome } from '@/lib/auth';
import QcDocumentEditor from '@/components/QcDocumentEditor';

export const dynamic = 'force-dynamic';

export default async function QcDocumentPage({ params }) {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'QC')) redirect(roleHome(user));

  const project = await queryOne('SELECT id, project_no, customer_name, series FROM projects WHERE id = ?', [params.id]);
  if (!project) notFound();

  const detail = await getQcDocumentDetail(params.docId);
  if (!detail || String(detail.document.project_id) !== String(params.id)) notFound();

  // The whole bank is linkable: picking a cert for a part auto-associates it with this project
  // (handled in link-parts). certificate_projects is many-to-many, so a shared plate is reusable.
  const certificates = await getTestCertificates();
  const bomItems = await getBomItemsForProject(params.id);
  const approvals = await getTcMatchApprovals();
  const assemblies = await getBomAssembliesFlat(params.id);

  return (
    <QcDocumentEditor
      project={project}
      document={detail.document}
      parts={detail.parts}
      mountings={detail.mountings}
      groups={detail.groups}
      certificates={certificates}
      bomItems={bomItems}
      approvals={approvals}
      assemblies={assemblies}
      canEdit={canAccessDepartment(user, 'QC')}
      currentUserName={user.display_name || user.username}
    />
  );
}
