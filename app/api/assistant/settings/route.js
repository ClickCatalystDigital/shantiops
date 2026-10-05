import { NextResponse } from 'next/server';
import { getFreshSessionUser, isAdmin } from '@/lib/auth';
import { getAssistantSettings, saveAssistantSettings } from '@/lib/assistant';
import { audit } from '@/lib/usb';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getFreshSessionUser();
  if (!isAdmin(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await getAssistantSettings());
}

// { model?, key? } — key '' removes it. The key is never returned and never audited.
export async function PUT(req) {
  const user = await getFreshSessionUser();
  if (!isAdmin(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();
  try {
    await saveAssistantSettings({ model: b.model, key: b.key, mode: b.mode });
  } catch (err) {
    return NextResponse.json({ error: `Could not save: ${err.message}` }, { status: 400 });
  }
  await audit('assistant_settings', { actor: user.username, detail: JSON.stringify({ model: b.model, mode: b.mode, key_changed: b.key !== undefined }) });
  return NextResponse.json(await getAssistantSettings());
}
