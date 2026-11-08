// Code → tokens, and refresh (lib/oauth.js). Accepts the form encoding OAuth uses, or JSON.
import { exchange } from '@/lib/oauth';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
export const OPTIONS = () => new Response(null, { status: 204, headers: CORS });
export async function POST(req) {
  if (process.env.DEMO_MODE === '1') return new Response('Not found', { status: 404 });
  const type = req.headers.get('content-type') || '';
  const p = type.includes('application/json') ? await req.json().catch(() => ({})) : Object.fromEntries(new URLSearchParams(await req.text()));
  try {
    return Response.json(await exchange(p), { headers: { ...CORS, 'Cache-Control': 'no-store' } });
  } catch (e) {
    return Response.json({ error: e.oauth || 'invalid_request', error_description: e.message }, { status: 400, headers: CORS });
  }
}
