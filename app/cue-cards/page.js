import { redirect } from 'next/navigation';
import { getFreshSessionUser, isInternal } from '@/lib/auth';
import CueCards from '@/components/CueCards';

export const dynamic = 'force-dynamic';

export default async function CueCardsPage() {
  if (!isInternal(await getFreshSessionUser())) redirect('/');
  return <main className="container flex flex-col gap-5 py-6"><CueCards /></main>;
}
