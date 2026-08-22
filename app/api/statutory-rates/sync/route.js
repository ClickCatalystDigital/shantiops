// app/api/statutory-rates/sync/route.js — pulls approved rates from statutory-rates-hub.
// Machine-triggered (cron via curl, or a future admin button), so it's a static shared-secret
// header rather than the usual session/department gate — a cron job has no browser session.
import { NextResponse } from 'next/server';
import { syncRatesFromHub } from '@/lib/rate-sync';

export async function POST(req) {
  const key = req.headers.get('x-sync-key');
  if (!key || key !== process.env.RATE_SYNC_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await syncRatesFromHub();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
