// app/api/company-settings/preview-gstin/route.js — GSTIN lookup for the "New Company" dialog,
// before any company_settings row exists yet. The existing [id]/verify-gstin route hard-requires
// an existing row to diff against; this is the id-less sibling — a pure lookup, no diff, nothing
// written. Reuses fetchFromHub()/mapSandboxResponse() from the [id] route rather than duplicating
// the hub call.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { fetchFromHub } from '../[id]/verify-gstin/route';

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;

  const b = await req.json();
  const gstin = String(b.gstin || '').trim();
  if (!gstin) return NextResponse.json({ error: 'gstin required' }, { status: 400 });

  try {
    const mapped = await fetchFromHub(gstin);
    return NextResponse.json(mapped);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
