import { NextResponse } from 'next/server';
import { getFreshSessionUser, isInternal } from '@/lib/auth';
import { getDataAccess } from '@/lib/assistant';
import { LEVELS, AREAS, fillCards, PLANNED, PLANNED_GROUPS, CARD_STATUS } from '@/lib/cue-cards';

// Cue Cards: the ladder, the areas and this person's prompts, filled with this system's own records (lib/cue-cards.js).
export async function GET() {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const dataOn = (await getDataAccess()).on;
  // Diagnose (live-data answers) is built everywhere but switched on per system; say which it is here.
  const levels = LEVELS.map(l => (l.key === 'diagnose' && !dataOn ? { ...l, status: 'off' } : l));
  return NextResponse.json({ levels, areas: AREAS, cards: await fillCards(user, { dataOn }), planned: PLANNED, plannedGroups: PLANNED_GROUPS, status: CARD_STATUS });
}
