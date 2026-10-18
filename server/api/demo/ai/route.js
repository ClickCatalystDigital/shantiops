import { NextResponse } from 'next/server';
import { demoAiLeft, DEMO_AI_QUESTIONS, isOwnerPass } from '@/lib/demo-leads';

// Public demo: the OPS AI widget asks this on load. Hidden when the demo has no AI key; locked when left is 0.
export async function GET(req) {
  if (process.env.DEMO_MODE !== '1') return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const enabled = !!process.env.DEMO_OPENROUTER_KEY;
  const left = enabled ? await demoAiLeft(req.cookies.get('demo_lead')?.value) : 0;
  return NextResponse.json({ enabled, pass: isOwnerPass(req.cookies.get('demo_lead')?.value), left, limit: DEMO_AI_QUESTIONS });
}
