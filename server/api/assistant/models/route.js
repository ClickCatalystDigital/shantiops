import { NextResponse } from 'next/server';
import { getFreshSessionUser } from '@/lib/auth';
import { OPENROUTER, canManageAssistant } from '@/lib/assistant';

export const dynamic = 'force-dynamic';

// OpenRouter's public model list (no key needed), kept for an hour.
let cache = { at: 0, models: [] };

export async function GET() {
  const user = await getFreshSessionUser();
  if (!canManageAssistant(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (Date.now() - cache.at > 3600_000) {
    try {
      const res = await fetch(`${OPENROUTER}/models`);
      if (!res.ok) throw new Error(`OpenRouter returned ${res.status}`);
      const perM = v => (Number(v) >= 0 ? Number(v) * 1e6 : null); // -1 = varies (routers)
      const models = (await res.json()).data
        .filter(m => m.architecture?.output_modalities?.includes('text'))
        .map(m => ({ id: m.id, name: m.name, context: m.context_length, in: perM(m.pricing?.prompt), out: perM(m.pricing?.completion) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      cache = { at: Date.now(), models };
    } catch (err) {
      if (!cache.models.length) return NextResponse.json({ error: `Could not load the model list: ${err.message}` }, { status: 502 });
    }
  }
  return NextResponse.json({ models: cache.models });
}
