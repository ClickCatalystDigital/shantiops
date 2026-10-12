// app/api/audit-log/route.js — read-only view onto usb_audit (SYSTEM.md: "the system-wide audit
// trail, not just the security platform's" — 215 call sites already write to it; this is the first
// UI to read it back). Accounts-gated for now — PM-only global view was the other option SYSTEM.md
// flagged as undecided; Accounts is the department that actually needs this for compliance.
import { NextResponse } from 'next/server';
import { queryAll } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q');
  const limit = Math.min(Number(searchParams.get('limit')) || 200, 1000);
  if (q) {
    const like = `%${q}%`;
    return NextResponse.json(await queryAll(
      'SELECT * FROM usb_audit WHERE action LIKE ? OR actor LIKE ? OR detail LIKE ? ORDER BY id DESC LIMIT ?',
      [like, like, like, limit]
    ));
  }
  return NextResponse.json(await queryAll('SELECT * FROM usb_audit ORDER BY id DESC LIMIT ?', [limit]));
}
