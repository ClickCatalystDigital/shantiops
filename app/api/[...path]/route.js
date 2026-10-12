// One entry point for every API route that lives in server/api/ (same URL, same handler file). Next
// keeps each route entry's modules in memory once used (~400 KB per route); handlers loaded through
// here share one copy. Routes still in app/api/ are matched by Next first and never reach this file.
// Behaviour copied from Next's route handling: 405 for a method the route doesn't export, HEAD
// answered by GET, OPTIONS answered with Allow (sorted). Unknown /api paths get a JSON 404 (Next
// sent its HTML 404 page; no screen calls an unknown path).
import { ROUTES } from '@/server/api-routes.generated.js';
import { buildTree, matchRoute } from '@/lib/api-match.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const tree = buildTree(Object.keys(ROUTES));

async function dispatch(method, req, ctx) {
  const { path = [] } = await ctx.params;
  const hit = matchRoute(tree, path);
  if (!hit) return Response.json({ error: 'Not found' }, { status: 404 });
  const mod = await ROUTES[hit.key]();
  // Like Next 15: a Promise that also carries the values, so `await params` and the older
  // `params.id` both work (lead-hooks still reads params.token directly).
  const handlerCtx = { params: Object.assign(Promise.resolve(hit.params), hit.params) };
  if (typeof mod[method] === 'function') return mod[method](req, handlerCtx);
  if (method === 'HEAD' && typeof mod.GET === 'function') return mod.GET(req, handlerCtx);
  if (method === 'OPTIONS') {
    const allow = METHODS.filter((m) => typeof mod[m] === 'function');
    if (mod.GET) allow.push('HEAD');
    allow.push('OPTIONS');
    return new Response(null, { status: 204, headers: { Allow: allow.sort().join(', ') } });
  }
  return new Response(null, { status: 405 });
}

export const GET = (req, ctx) => dispatch('GET', req, ctx);
export const POST = (req, ctx) => dispatch('POST', req, ctx);
export const PUT = (req, ctx) => dispatch('PUT', req, ctx);
export const PATCH = (req, ctx) => dispatch('PATCH', req, ctx);
export const DELETE = (req, ctx) => dispatch('DELETE', req, ctx);
export const HEAD = (req, ctx) => dispatch('HEAD', req, ctx);
export const OPTIONS = (req, ctx) => dispatch('OPTIONS', req, ctx);
