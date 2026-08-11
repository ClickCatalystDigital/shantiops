import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { requireCalcAccess, saveSnapshot } from '@/lib/calc';
import { audit } from '@/lib/usb';

export async function POST(req) {
  const user = getSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;

  const b = await req.json();
  const label = String(b.label || '').trim() || `Snapshot ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
  if (!b.sheetId) return NextResponse.json({ error: 'sheetId is required' }, { status: 400 });

  const id = await saveSnapshot(b.sheetId, label, user.username);
  await audit('calc_snapshot_saved', { actor: user.username, detail: label });
  return NextResponse.json({ id });
}
