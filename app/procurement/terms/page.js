// /procurement/terms — edit the optional Terms and Conditions page printed after every Purchase Order
// (lib/po-terms.mjs). Opened from Procurement → Purchase Orders. A real page, so the
// /procurement/<tab> rewrite (next.config.js) doesn't apply.
import { redirect } from 'next/navigation';
import { getFreshSessionUser, canAccessDepartment, roleHome } from '@/lib/auth';
import { canPerformAction } from '@/lib/action-permissions';
import { getCompanySettings } from '@/lib/data';
import { cleanPoTerms } from '@/lib/po-terms.mjs';
import PoTermsEditor from '@/components/PoTermsEditor';

export const dynamic = 'force-dynamic';

export default async function PoTermsPage() {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'Procurement')) redirect(roleHome(user));
  const rows = await getCompanySettings();
  const companies = rows.map(r => ({ id: r.id, company: r.company, legal_name: r.legal_name, terms: cleanPoTerms(r.po_terms_json) }));
  const canEdit = await canPerformAction(user, 'Procurement', 'procurement.po.terms.write');
  return <PoTermsEditor companies={companies} canEdit={canEdit} />;
}
