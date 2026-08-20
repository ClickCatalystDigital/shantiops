// QC workspace (QC-CHANGES.md) — department-gated top-level route with two project-scoped tabs
// (Test Certificates + Documents), rendered by one client workspace component.
import { redirect } from 'next/navigation';
import { getFreshSessionUser, canAccessDepartment, roleHome } from '@/lib/auth';
import { getTestCertificates, getAllQcDocuments, getActiveProjectsList, getCalibrationItems } from '@/lib/data';
import QcWorkspace from '@/components/QcWorkspace';

export const dynamic = 'force-dynamic';

export default async function QcPage({ searchParams }) {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'QC')) redirect(roleHome(user));

  const sp = await searchParams;
  const [projects, certificates, documents, calibrationItems] = await Promise.all([
    getActiveProjectsList(),
    getTestCertificates(),
    getAllQcDocuments(),
    getCalibrationItems(), // STERP items 34/35, §5p — not project-scoped, so not filtered below
  ]);

  return <QcWorkspace projects={projects} certificates={certificates} documents={documents}
    calibrationItems={calibrationItems} initialTab={sp?.tab} initialProject={sp?.project} />;
}
