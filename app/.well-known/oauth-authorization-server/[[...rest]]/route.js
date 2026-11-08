import { authServerMetadata, originOf } from '@/lib/oauth';
export const dynamic = 'force-dynamic';
export function GET(req) {
  if (process.env.DEMO_MODE === '1') return new Response('Not found', { status: 404 });
  return Response.json(authServerMetadata(originOf(req)), { headers: { 'Access-Control-Allow-Origin': '*' } });
}
