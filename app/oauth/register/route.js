// Dynamic client registration: an AI app (Claude, ChatGPT…) registers itself before sending someone to sign in.
import { registerClient } from '@/lib/oauth';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
export const OPTIONS = () => new Response(null, { status: 204, headers: CORS });
export async function POST(req) {
  if (process.env.DEMO_MODE === '1') return new Response('Not found', { status: 404 });
  try {
    return Response.json(await registerClient(await req.json().catch(() => ({}))), { status: 201, headers: CORS });
  } catch (e) {
    return Response.json({ error: e.code || 'invalid_client_metadata', error_description: e.message }, { status: 400, headers: CORS });
  }
}
