import { NextResponse } from 'next/server';
import { getFreshSessionUser, isInternal, isAdmin } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import { runAction, runUndo } from '@/lib/assistant-act';
import { getActionSettings, mayAuto, autoPrefKey } from '@/lib/assistant';
import { getAppSetting, setAppSetting } from '@/lib/db';
import { fill, actionsFor, ACTION_BY_KEY } from '@/lib/assistant-actions';

// Save on an Ember AI action card: { action, fields } → the app's own route, as this person (lib/assistant-act.js).
// { preview: true, action, text } (admin, for scripts/check-actions.mjs): the card a message would give, no model, nothing saved.
export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { action, fields, preview, text, list, as, auto, undo } = await req.json().catch(() => ({}));
  // { list: true, as } (admin, for scripts/check-actions.mjs): the action keys that person is offered.
  if (list) {
    if (!isAdmin(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const who = as ? await queryOne('SELECT * FROM users WHERE username = ? AND active = 1', [String(as)]) : user;
    if (!who) return NextResponse.json({ error: 'No such user' }, { status: 404 });
    return NextResponse.json({ actions: (await actionsFor(who)).map(a => a.key) });
  }
  if (preview) {
    if (!isAdmin(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (!ACTION_BY_KEY[action] || !(await actionsFor(user)).includes(ACTION_BY_KEY[action])) return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    return NextResponse.json(await fill(action, String(text || ''), user));
  }
  // { action, fields, auto: true }: chat's Auto mode (the server decides if the card may be skipped). { undo }: Undo.
  const out = undo ? await runUndo(user, undo) : await runAction(user, action, fields || {}, { auto: auto === true });
  return NextResponse.json(out, { status: out.ok ? 200 : [403, 409, 500].includes(out.status) ? out.status : 400 });
}

// The chat's Manual / Auto switch: may this person use Auto, and is it on for them (remembered per person).
export async function GET() {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const s = await getActionSettings();
  const may = mayAuto(user, s);
  return NextResponse.json({ on: s.on, mayAuto: may, auto: may && (await getAppSetting(autoPrefKey(user))) === '1' });
}
export async function PUT(req) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { auto } = await req.json().catch(() => ({}));
  if (!mayAuto(user, await getActionSettings())) return NextResponse.json({ error: 'Auto is not allowed for your role' }, { status: 403 });
  await setAppSetting(autoPrefKey(user), auto ? '1' : '0');
  return NextResponse.json({ auto: !!auto });
}
