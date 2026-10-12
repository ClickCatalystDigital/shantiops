// app/api/statutory-rates/sync/route.js — pulls approved rates from statutory-rates-hub.
// Machine-triggered (a Cloudflare Cron Trigger's Worker fetching this daily, or curl for manual
// runs), so it's a static shared-secret header rather than the usual session/department gate — a
// cron job has no browser session.
//
// POST runs the sync job. GET reads the last run's heartbeat without triggering another sync —
// for a monitoring check to confirm the cron is actually firing (hub_sync_state.last_run_at) and
// not just that the endpoint responds. Same auth on both.
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { runRateSyncJob, getRateSyncHeartbeat } from '@/lib/rate-sync';
import { audit } from '@/lib/usb';

// Constant-time comparison for the shared secret — a plain !== leaks timing information about how
// many leading characters matched, which matters for a long-lived static secret with no rate limit
// in front of it (this endpoint is meant to be hit once a day by a trusted Worker, not behind a
// login form with lockout).
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a ?? ''));
  const bufB = Buffer.from(String(b ?? ''));
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function checkAuth(req) {
  const key = req.headers.get('x-sync-key');
  return !!key && !!process.env.RATE_SYNC_KEY && safeEqual(key, process.env.RATE_SYNC_KEY);
}

export async function POST(req) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const result = await runRateSyncJob();
    await audit('rate_sync_run', { actor: 'system:rate-sync-cron', detail: JSON.stringify(result) });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    await audit('rate_sync_failed', { actor: 'system:rate-sync-cron', detail: e.message }).catch(() => {});
    // 502 when the hub itself is the problem (unreachable, non-2xx, bad response) — a Worker or
    // uptime check watching status codes can tell "upstream is down, don't page yet" apart from
    // "our own code broke" (500: an insert failed, the post-sync verification read-back failed).
    return NextResponse.json({ ok: false, error: e.message }, { status: e.isHubError ? 502 : 500 });
  }
}

export async function GET(req) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const heartbeat = await getRateSyncHeartbeat();
  return NextResponse.json(heartbeat);
}
