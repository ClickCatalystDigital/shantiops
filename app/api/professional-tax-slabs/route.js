import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getProfessionalTaxSlabs, insertProfessionalTaxSlab } from '@/lib/data';
import { audit } from '@/lib/usb';

export async function GET() {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  return NextResponse.json(await getProfessionalTaxSlabs());
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'HR');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'HR', 'hr.statutory.write');
  if (actionDenied) return actionDenied;
  const b = await req.json();
  try {
    const id = await insertProfessionalTaxSlab(b);
    await audit('professional_tax_slab_added', { actor: user.username, detail: `${b.state}: ${b.min_gross}+ @ ${b.amount}` });
    return NextResponse.json({ id });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
