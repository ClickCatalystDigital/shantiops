import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { disposeFixedAsset } from '@/lib/fixed-assets';
import { audit } from '@/lib/usb';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Accounts', 'accounts.fixed_asset.write');
  if (actionDenied) return actionDenied;
  const b = await req.json();
  if (!b.disposal_date) return NextResponse.json({ error: 'disposal_date is required' }, { status: 400 });
  try {
    await disposeFixedAsset(Number(params.id), {
      disposalDate: b.disposal_date, disposalAmount: Number(b.disposal_amount) || 0, createdBy: user.username,
    });
    await audit('fixed_asset_disposed', { actor: user.username, detail: `#${params.id} for ${b.disposal_amount || 0}` });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
