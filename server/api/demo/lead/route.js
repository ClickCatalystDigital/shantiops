import { NextResponse } from 'next/server';
import { saveDemoLead, emailDemoLead } from '@/lib/demo-leads';

const clip = (v, n) => String(v ?? '').trim().slice(0, n);

// Public demo entry form. Stores the visitor, then the demo_lead cookie lets them pick a role.
export async function POST(req) {
  if (process.env.DEMO_MODE !== '1') return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const b = await req.json().catch(() => ({}));
  const lead = {
    name: clip(b.name, 120), company: clip(b.company, 160), email: clip(b.email, 160).toLowerCase(),
    phone: clip(b.phone, 40), manufactures: clip(b.manufactures, 200),
  };
  if (!lead.name || !lead.company) return NextResponse.json({ error: 'Name and company are required' }, { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) return NextResponse.json({ error: 'Enter a valid email' }, { status: 400 });
  const token = await saveDemoLead({ ...lead, ip: req.headers.get('cf-connecting-ip'), userAgent: clip(req.headers.get('user-agent'), 300) });
  await emailDemoLead(lead);
  const res = NextResponse.json({ ok: true });
  res.cookies.set('demo_lead', token, { path: '/', httpOnly: true, sameSite: 'lax', secure: true, maxAge: 60 * 60 * 24 * 30 });
  return res;
}
