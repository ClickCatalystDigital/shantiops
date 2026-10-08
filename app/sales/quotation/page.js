// /sales/quotation — the combined New Quotation + Send Commercial Offer page (see QuotationComposer).
import { redirect } from 'next/navigation';
import { getFreshSessionUser, canAccessDepartment, roleHome } from '@/lib/auth';
import { getSalesProducts } from '@/lib/data';
import QuotationComposer from '@/components/QuotationComposer';

export const dynamic = 'force-dynamic';

export default async function QuotationPage({ searchParams }) {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'Sales')) redirect(roleHome(user));
  const sp = await searchParams;
  const num = v => (v && /^\d+$/.test(String(v)) ? Number(v) : null);
  return (
    <QuotationComposer salesProducts={await getSalesProducts()} leadId={num(sp?.lead)} reviseId={num(sp?.revise)} sendId={num(sp?.send)} customerId={num(sp?.customer) || ''} />
  );
}
