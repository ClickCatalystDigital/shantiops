import { NextResponse } from 'next/server';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { getPreDispatchApprovalDetail } from '@/lib/data';

export async function GET(req, props) {
  const params = await props.params;
  const user = await getFreshSessionUser();
  if (!['QC', 'Production', 'Dispatch', 'Accounts'].some(d => canAccessDepartment(user, d))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const detail = await getPreDispatchApprovalDetail(params.id);
  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // The sale order link only for someone who can open Sales.
  // Where this person can see the order's payments: their own department's Payment Log.
  const so = detail.payment?.so_no;
  const logHref = !so ? null : canAccessDepartment(user, 'Accounts') ? `/accounts/payment-log?q=${encodeURIComponent(so)}`
    : canAccessDepartment(user, 'Sales') ? `/sales/payment-log?q=${encodeURIComponent(so)}` : null;
  return NextResponse.json({ ...detail, paymentLogHref: logHref });
}
