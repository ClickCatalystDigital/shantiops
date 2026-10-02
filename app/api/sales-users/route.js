// app/api/sales-users/route.js — active Sales users (username + name) for pickers outside /sales (e.g. Customer 360's add-on enquiry).
import { NextResponse } from 'next/server';
import { queryAll } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';

export async function GET() {
  const user = await getFreshSessionUser();
  if (!user || !canAccessDepartment(user, 'Sales')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await queryAll(
    `SELECT username, display_name FROM users WHERE active = 1 AND pending = 0 AND role != 'customer' AND (',' || COALESCE(departments,'') || ',') LIKE '%,Sales,%' ORDER BY display_name`));
}
