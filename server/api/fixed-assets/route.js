import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getFixedAssets, insertFixedAsset } from '@/lib/fixed-assets';
import { audit } from '@/lib/usb';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const company = COMPANY_NAMES.includes(searchParams.get('company')) ? searchParams.get('company') : COMPANY_NAMES[0];
  return NextResponse.json(await getFixedAssets(company));
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Accounts', 'accounts.fixed_asset.write');
  if (actionDenied) return actionDenied;
  const b = await req.json();
  const company = COMPANY_NAMES.includes(b.company) ? b.company : COMPANY_NAMES[0];
  try {
    const { id, assetNo } = await insertFixedAsset({
      company, name: b.name, category: b.category, purchaseDate: b.purchase_date,
      cost: Number(b.cost), salvageValue: Number(b.salvage_value) || 0,
      usefulLifeYears: Number(b.useful_life_years), method: b.method, createdBy: user.username,
    });
    await audit('fixed_asset_added', { actor: user.username, detail: `${assetNo}: ${b.name} @ ${b.cost}` });
    return NextResponse.json({ id, asset_no: assetNo });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
