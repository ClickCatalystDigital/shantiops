// lib/assistant-act.js — runs an Ember AI action (lib/assistant-actions.js) through the app's own API route, in the same
// process: the request the screen would send, as the person asking (lib/auth.js runAs). So the route's checks,
// validation, notifications and audit apply exactly as on screen. Chat calls it inside the person's own request, so
// the demo owner-pass routing (lib/db.js ownerClient) and the department view cookie apply too.
// Manual / Auto (Settings → Assistant): in chat's Auto mode an add or edit with a clean reverse saves at once and comes
// back with a signed Undo (30 minutes, only for the same person). The server decides, never the browser.
import jwt from 'jsonwebtoken';
import { ROUTES } from '@/server/api-routes.generated.js';
import { buildTree, matchRoute } from './api-match.mjs';
import { runAs, signToken, verifyToken } from './auth';
import { queryOne } from './db';
import { check, ACTION_BY_KEY, actionsFor, autoOk } from './assistant-actions';
import { getActionSettings, mayAuto } from './assistant';

const tree = buildTree(Object.keys(ROUTES));
const secret = () => process.env.SESSION_SECRET || (process.env.NODE_ENV === 'production' ? null : 'dev-only-insecure-secret');

async function call(user, { method, path, body }) {
  const hit = matchRoute(tree, path.replace(/^\/api\//, '').split('/'));
  const handler = hit && (await ROUTES[hit.key]())[method];
  if (!handler) throw new Error(`No route for ${method} ${path}`);
  const req = new Request(`http://assistant.local${path}`, { method, headers: { 'content-type': 'application/json' }, body: method === 'DELETE' ? undefined : JSON.stringify(body) });
  const res = await runAs(verifyToken(signToken(user)), () => handler(req, { params: Object.assign(Promise.resolve(hit.params), hit.params) }));
  return { res, data: await res.json().catch(() => ({})) };
}

// Check the fields again (never trust a card or an MCP client), then run. Returns { ok, status, summary, link, result, undo? | error }.
// auto: chat's Auto mode; if this person or this action may not skip the card, nothing is saved and the card comes back (needsCard).
export async function runAction(user, key, given, { auto = false } = {}) {
  const a = ACTION_BY_KEY[key];
  const settings = await getActionSettings();
  if (!settings.on) return { ok: false, status: 403, error: 'Changes from the assistant are switched off in Settings → Assistant.' };
  if (!a || !(await actionsFor(user)).includes(a)) return { ok: false, status: 400, error: `Unknown action: ${key}` };
  const c = await check(key, given, user);
  if (!c.ready) return { ok: false, status: 400, summary: c.summary, error: [...c.errors, ...(c.missing.length ? [`Missing: ${c.missing.join(', ')}`] : [])].join('. '), card: c };
  if (auto && !(mayAuto(user, settings) && autoOk(a))) return { ok: false, status: 409, needsCard: true, error: 'This one needs a check: press Save on the card.', card: c };
  try {
    const r = auto && a.undo.restore;
    // ponytail: a put-back restores the columns as they were, so an edit someone made in between is overwritten too.
    const before = r ? await queryOne(`SELECT ${r.cols.join(', ')} FROM ${r.table} WHERE id = ?`, [c.values[r.id]]) : null;
    const { res, data } = await call(user, await a.request(c.values, user));
    if (!res.ok) return { ok: false, status: res.status, summary: c.summary, error: data.error || `The app refused it (${res.status})` };
    const out = { ok: true, status: res.status, summary: c.summary, link: a.link?.(data, c.values) || null, result: data };
    if (auto) {
      const back = a.undo.del ? { method: 'DELETE', path: a.undo.del(data, c.values) } : r ? { method: 'PATCH', path: r.path(c.values), body: before } : a.undo.request(c.values);
      out.undo = jwt.sign({ u: user.username, s: c.summary, r: back }, secret(), { expiresIn: '30m', audience: 'assistant-undo' });
    }
    return out;
  } catch (e) {
    return { ok: false, status: 500, summary: c.summary, error: e.message };
  }
}

// Run an Undo token from runAction: the reverse request, through the same route, as the same person.
export async function runUndo(user, token) {
  let t;
  try { t = jwt.verify(String(token || ''), secret(), { audience: 'assistant-undo' }); } catch { return { ok: false, status: 400, error: 'Too late to undo here; change it on its screen.' }; }
  if (t.u !== user.username) return { ok: false, status: 403, error: 'That change was made by someone else.' };
  try {
    const { res, data } = await call(user, t.r);
    return res.ok ? { ok: true, summary: `Undone: ${t.s}` } : { ok: false, status: res.status, error: data.error || `The app refused it (${res.status})` };
  } catch (e) { return { ok: false, status: 500, error: e.message }; }
}
