// app/api/email-templates/route.js — Phase 3.2. GET ?company=&active=1 orders by created_at DESC
// so the most recently created active template for that company is the natural "current" pick;
// the UI still shows a real picker whenever more than one matches (never a hidden auto-choice).
import { NextResponse } from 'next/server';
import { execute, queryAll } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment, isPM } from '@/lib/auth';
import { COMPANY_NAMES } from '@/lib/company-profiles.js';
import { audit } from '@/lib/usb';

const CRM_DEPARTMENTS = ['Sales', 'Marketing'];
function canAccessCrm(user) {
  return isPM(user) || CRM_DEPARTMENTS.some(d => canAccessDepartment(user, d));
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!canAccessCrm(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const company = sp.get('company');
  const activeOnly = sp.get('active') === '1';
  let sql = 'SELECT * FROM email_templates WHERE 1=1';
  const args = [];
  if (company) { sql += ' AND company = ?'; args.push(company); }
  if (activeOnly) sql += ' AND active = 1';
  sql += ' ORDER BY created_at DESC';
  return NextResponse.json(await queryAll(sql, args));
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!canAccessCrm(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const b = await req.json();
  const name = String(b.name || '').trim();
  const body = String(b.body || '').trim();
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  if (!body) return NextResponse.json({ error: 'Body is required' }, { status: 400 });
  if (!COMPANY_NAMES.includes(b.company)) return NextResponse.json({ error: 'Invalid company' }, { status: 400 });

  const { lastId } = await execute(
    `INSERT INTO email_templates (name, company, subject, body, regards, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [name, b.company, b.subject || null, body, b.regards || null, user.username]
  );
  await audit('email_template_created', { actor: user.username, detail: `${b.company}: ${name}` });
  return NextResponse.json({ id: Number(lastId) });
}
