// lib/assistant-act.js — runs an Ember AI action (lib/assistant-actions.js) through the app's own API route, in the same
// process: the request the screen would send, as the person asking (lib/auth.js runAs). So the route's checks,
// validation, notifications and audit apply exactly as on screen. Chat calls it inside the person's own request, so
// the demo owner-pass routing (lib/db.js ownerClient) and the department view cookie apply too.
import { ROUTES } from '@/server/api-routes.generated.js';
import { buildTree, matchRoute } from './api-match.mjs';
import { runAs, signToken, verifyToken } from './auth';
import { check, ACTION_BY_KEY, actionsFor } from './assistant-actions';

const tree = buildTree(Object.keys(ROUTES));

// Check the fields again (never trust a card or an MCP client), then run. Returns { ok, status, summary, link, result | error }.
export async function runAction(user, key, given) {
  const a = ACTION_BY_KEY[key];
  if (!a || !(await actionsFor(user)).includes(a)) return { ok: false, status: 400, error: `Unknown action: ${key}` };
  const c = await check(key, given, user);
  if (!c.ready) return { ok: false, status: 400, summary: c.summary, error: [...c.errors, ...(c.missing.length ? [`Missing: ${c.missing.join(', ')}`] : [])].join('. '), card: c };
  try {
    const { method, path, body } = await a.request(c.values, user);
    const hit = matchRoute(tree, path.replace(/^\/api\//, '').split('/'));
    const handler = hit && (await ROUTES[hit.key]())[method];
    if (!handler) throw new Error(`No route for ${method} ${path}`);
    const req = new Request(`http://assistant.local${path}`, { method, headers: { 'content-type': 'application/json' }, body: method === 'DELETE' ? undefined : JSON.stringify(body) });
    const res = await runAs(verifyToken(signToken(user)), () => handler(req, { params: Object.assign(Promise.resolve(hit.params), hit.params) }));
    const data = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, status: res.status, summary: c.summary, link: a.link?.(data, c.values) || null, result: data }
      : { ok: false, status: res.status, summary: c.summary, error: data.error || `The app refused it (${res.status})` };
  } catch (e) {
    return { ok: false, status: 500, summary: c.summary, error: e.message };
  }
}
