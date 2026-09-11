// app/projects/[id]/qc/[docId]/page.js

import { notFound, redirect } from 'next/navigation';
import { queryOne } from '@/lib/db';
import { getQcDocumentDetail, getTestCertificates, getBomItemsForProject, getTcMatchApprovals, getBomAssembliesFlat, getChildDerivedBom } from '@/lib/data';
import { getFreshSessionUser, canAccessDepartment, roleHome } from '@/lib/auth';
import QcDocumentEditor from '@/components/QcDocumentEditor';

export const dynamic = 'force-dynamic';

export default async function QcDocumentPage({ params }) {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'QC')) redirect(roleHome(user));

  const project = await queryOne('SELECT id, project_no, customer_name, series, master_project_id FROM projects WHERE id = ?', [params.id]);
  if (!project) notFound();

  const detail = await getQcDocumentDetail(params.docId);
  if (!detail || String(detail.document.project_id) !== String(params.id)) notFound();

  // The whole bank is linkable: picking a cert for a part auto-associates it with this project
  // (handled in link-parts). certificate_projects is many-to-many, so a shared plate is reusable.
  const certificates = await getTestCertificates();
  // Multi-unit split fix: a child project never has its own bom_items rows (confirmed
  // architecture — the master's BOM is shared), so getBomItemsForProject(params.id) always
  // returned [] for a child's document, silently disabling suggestCertificates()'s exact/fuzzy
  // matching and the "Link to BOM item" picker for every split-child document. qc_document_parts
  // .bom_item_id on a child's document already points at the MASTER's own bom_items.id
  // (syncQcPartsFromBom is seeded from the master, not the child — same confirmed architecture),
  // so resolving to the master here is correct, not an approximation.
  const bomItems = await getBomItemsForProject(project.master_project_id || params.id);
  const approvals = await getTcMatchApprovals();
  // Same fix as bomItems above — a split child has no bom_assemblies rows of its own, so the "New
  // Form III A group" dialog's assembly picker was silently empty for every split-child document.
  const assemblies = await getBomAssembliesFlat(project.master_project_id || params.id);

  // Multi-unit split — a document on a split child gets no exact/fuzzy suggestions from
  // suggestCertificates() at all (bomItems is always [] for a child, since children never have
  // their own bom_items rows), so this is the one real signal available: whichever certificate(s)
  // QC has already linked to this exact unit's material via the /qc "Assign to Units" workflow
  // (bom_item_child_certificates, read here through the same getChildDerivedBom() ChildUnitBomCard
  // already uses — no new query). Passed down as a plain {bomItemId: certificates[]} map; empty for
  // every ordinary (non-split) project, so QcDocumentEditor's merge is a no-op there.
  let unitCertsByItem = {};
  if (project.master_project_id) {
    const derived = await getChildDerivedBom(project.id);
    if (derived) {
      unitCertsByItem = Object.fromEntries(
        derived.items.filter(it => it.certificates?.length).map(it => [it.id, it.certificates])
      );
    }
  }

  return (
    <QcDocumentEditor
      project={project}
      document={detail.document}
      parts={detail.parts}
      mountings={detail.mountings}
      groups={detail.groups}
      seams={detail.seams}
      certificates={certificates}
      bomItems={bomItems}
      approvals={approvals}
      assemblies={assemblies}
      unitCertsByItem={unitCertsByItem}
      canEdit={canAccessDepartment(user, 'QC')}
      currentUserName={user.display_name || user.username}
    />
  );
}
