import { NextResponse } from 'next/server';
import { getFreshSessionUser, isInternal, isAdmin } from '@/lib/auth';
import { runAction } from '@/lib/assistant-act';
import { fill, actionsFor, ACTION_BY_KEY } from '@/lib/assistant-actions';

// Save on an Ember AI action card: { action, fields } → the app's own route, as this person (lib/assistant-act.js).
// { preview: true, action, text } (admin, for scripts/check-actions.mjs): the card a message would give, no model, nothing saved.
export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { action, fields, preview, text } = await req.json().catch(() => ({}));
  if (preview) {
    if (!isAdmin(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (!ACTION_BY_KEY[action] || !actionsFor(user).includes(ACTION_BY_KEY[action])) return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    return NextResponse.json(await fill(action, String(text || ''), user));
  }
  const out = await runAction(user, action, fields || {});
  return NextResponse.json(out, { status: out.ok ? 200 : out.status === 500 ? 500 : 400 });
}
