// app/api/bom-items/[id]/quotes/route.js — the item's quote log, for the PO editor's "change
// supplier" picker (Group 5 Bundle A, 5.3). getItemQuotes already existed (lib/data.js) but had no
// API route of its own — only ever read server-side (app/requests/page.js's cancel-request detail).
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getItemQuotes } from '@/lib/data';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Procurement');
  if (denied) return denied;
  return NextResponse.json(await getItemQuotes(params.id));
}
