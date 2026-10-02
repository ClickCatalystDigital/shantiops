// POST /api/sales-team/[id]/reset-password — Sales Head / PM only. Sets a new random password and
// returns it ONCE. Only for Sales-only people: someone with another department (or a PM) keeps
// their account safe from this screen.
import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { execute } from '@/lib/db';
import { getFreshSessionUser, isDepartmentHead } from '@/lib/auth';
import { salesTarget, salesDeptsOnly } from '@/lib/sales-team';
import { audit } from '@/lib/usb';

const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newPassword = () => Array.from(randomBytes(10), b => ALPHABET[b % ALPHABET.length]).join('');

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  if (!user || !isDepartmentHead(user, 'Sales')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { target, error, status } = await salesTarget(params.id);
  if (error) return NextResponse.json({ error }, { status });
  if (!salesDeptsOnly(target.departments)) return NextResponse.json({ error: 'This person also has other departments — ask a PM to reset it' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const password = body.password ? String(body.password) : newPassword();
  if (password.length < 6) return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
  await execute('UPDATE users SET password = ? WHERE id = ?', [bcrypt.hashSync(password, 10), target.id]);
  await audit('sales_team_password_reset', { actor: user.username, detail: target.username });
  return NextResponse.json({ username: target.username, password });
}
