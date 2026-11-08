import { NextResponse } from 'next/server';
import { getFreshSessionUser, isInternal } from '@/lib/auth';
import { getDataAccess } from '@/lib/assistant';
import { LEVELS, AREAS, fillCards } from '@/lib/cue-cards';

// Cue Cards: the ladder, the areas and this person's prompts, filled with this system's own records (lib/cue-cards.js).
export async function GET() {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json({ levels: LEVELS, areas: AREAS, cards: await fillCards(user, { dataOn: (await getDataAccess()).on }) });
}
