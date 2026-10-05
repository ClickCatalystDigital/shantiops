import { NextResponse } from 'next/server';
import { getFreshSessionUser, isAdmin } from '@/lib/auth';
import { getAssistantSettings, saveAssistantSettings, getAssistantKey, getBalance, canManageAssistant, getDataAccess, setDataAccess, getLimits, saveLimits, LIMIT_KEYS, CREDITS_URL } from '@/lib/assistant';
import { audit } from '@/lib/usb';

export const dynamic = 'force-dynamic';

// Settings plus the credit left on the OpenRouter account (null = no key, or it could not be read).
async function withBalance() {
  const s = await getAssistantSettings();
  let balance = null;
  if (s.hasKey) { try { balance = await getBalance(await getAssistantKey()); } catch { /* key unreadable */ } }
  return { ...s, balance, creditsUrl: CREDITS_URL, limits: await getLimits(), limitKeys: LIMIT_KEYS };
}

export async function GET() {
  const user = await getFreshSessionUser();
  if (!canManageAssistant(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json({ ...(await withBalance()), isAdmin: isAdmin(user) });
}

// { model?, key? } — key '' removes it. The key is never returned and never audited.
export async function PUT(req) {
  const user = await getFreshSessionUser();
  if (!canManageAssistant(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();
  // { limits: { default, Sales, ..., Management } } — daily questions per person. Admin only.
  if (b.limits !== undefined) {
    if (!isAdmin(user)) return NextResponse.json({ error: 'Only admin can change the daily limits' }, { status: 403 });
    await saveLimits(b.limits);
    await audit('assistant_limits', { actor: user.username, detail: JSON.stringify(b.limits) });
    return NextResponse.json({ ...(await withBalance()), isAdmin: true });
  }
  // { dataAccess: { on, approver_name, approver_role, confirmed } } — admin only.
  if (b.dataAccess !== undefined) {
    if (!isAdmin(user)) return NextResponse.json({ error: 'Only admin can change live-data access' }, { status: 403 });
    const d = b.dataAccess || {};
    if (d.on) {
      const name = String(d.approver_name || '').trim();
      if (!name || !d.confirmed) return NextResponse.json({ error: "Enter the name of the customer's person who approved, and tick the confirmation." }, { status: 400 });
      const record = { on: true, approver_name: name.slice(0, 120), approver_role: String(d.approver_role || '').trim().slice(0, 120), recorded_by: user.username, at: new Date().toISOString(), terms: 'https://openrouter.ai/terms', privacy: 'https://openrouter.ai/privacy' };
      await setDataAccess(record);
      await audit('assistant_data_access_on', { actor: user.username, detail: JSON.stringify(record) });
    } else {
      const prev = await getDataAccess();
      await setDataAccess({ on: false, turned_off_by: user.username, turned_off_at: new Date().toISOString(), last_approval: prev.on ? prev : prev.last_approval || null });
      await audit('assistant_data_access_off', { actor: user.username, detail: null });
    }
    return NextResponse.json(await withBalance());
  }
  try {
    await saveAssistantSettings({ model: b.model, key: b.key, mode: b.mode });
  } catch (err) {
    return NextResponse.json({ error: `Could not save: ${err.message}` }, { status: 400 });
  }
  await audit('assistant_settings', { actor: user.username, detail: JSON.stringify({ model: b.model, mode: b.mode, key_changed: b.key !== undefined }) });
  return NextResponse.json(await withBalance());
}
