// PUT { mode: 'test'|'live', test_to? } — the safety switch. Only the Sales Head / PM can flip it.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, isDepartmentHead } from '@/lib/auth';
import { setAppSetting } from '@/lib/db';
import { audit } from '@/lib/usb';

export async function PUT(req) {
  const user = await getFreshSessionUser();
  if (!user || !isDepartmentHead(user, 'Sales')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();
  const mode = b.mode === 'live' ? 'live' : 'test';
  const testTo = String(b.test_to || '').trim();
  if (testTo && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(testTo)) return NextResponse.json({ error: 'Test address is not a valid email' }, { status: 400 });
  await setAppSetting('mail_mode', mode);
  await setAppSetting('mail_test_to', testTo);
  await audit('mail_mode_changed', { actor: user.username, detail: `${mode}${testTo ? ` (test to ${testTo})` : ''}` });
  return NextResponse.json({ ok: true });
}
