// workers/rate-sync-cron/src/index.js — Cloudflare Worker, daily Cron Trigger.
// Calls the shanti-ops production sync endpoint (POST /api/statutory-rates/sync, SYSTEM.md §5ag)
// and reports success/failure to a healthchecks.io dead-man's-switch: it pings on success/failure,
// and healthchecks.io itself emails if no ping arrives at all — the only way to catch "the cron
// stopped firing", since this Worker's own code can't detect its own non-invocation.
//
// Does not touch the sync logic itself (lib/rate-sync.js / app/api/statutory-rates/sync) — this is
// purely the scheduler + failure/heartbeat layer around that already-idempotent, already-verified
// endpoint.

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runSync(env));
  },

  // Manual trigger for testing, gated by the same shared secret the cron uses — lets you confirm
  // the whole chain (Worker -> sync endpoint -> healthchecks.io) works without waiting for 2:30 AM
  // IST. Not part of the cron path itself.
  async fetch(req, env) {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const key = req.headers.get('x-trigger-key');
    if (!key || key !== env.RATE_SYNC_KEY) return new Response('Unauthorized', { status: 401 });
    const result = await runSync(env);
    return new Response(JSON.stringify(result), {
      status: result.ok ? 200 : 502,
      headers: { 'content-type': 'application/json' },
    });
  },
};

async function runSync(env) {
  const syncUrl = env.SYNC_URL || 'https://shantiops.onrender.com/api/statutory-rates/sync';

  let res, body;
  try {
    res = await fetch(syncUrl, { method: 'POST', headers: { 'x-sync-key': env.RATE_SYNC_KEY } });
    body = await res.text();
  } catch (e) {
    const detail = `fetch failed: ${e.message}`;
    await pingHealthcheck(env, 'fail', detail);
    return { ok: false, error: detail };
  }

  // Any non-2xx (401 bad secret, 502 hub unreachable, 500 internal — see SYSTEM.md §5ag) is a
  // failed run, exactly as asked: no special-casing by status code here, that distinction already
  // happened server-side.
  if (!res.ok) {
    const detail = `HTTP ${res.status}: ${body.slice(0, 500)}`;
    await pingHealthcheck(env, 'fail', detail);
    return { ok: false, status: res.status, body };
  }

  await pingHealthcheck(env, 'success', body);
  return { ok: true, status: res.status, body };
}

async function pingHealthcheck(env, kind, detail) {
  const base = env.HEALTHCHECK_URL;
  if (!base) return; // not configured — sync still ran, just no external heartbeat this time
  const url = kind === 'success' ? base : `${base}/fail`;
  try {
    await fetch(url, { method: 'POST', body: String(detail || '').slice(0, 1000) });
  } catch {
    // Healthcheck ping itself failing shouldn't throw out of runSync — the sync result already
    // computed above is what matters and gets returned/logged regardless.
  }
}
