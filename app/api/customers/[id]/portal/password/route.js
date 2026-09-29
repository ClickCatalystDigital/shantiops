// POST { action: 'reveal' | 'reset' } — Sales Head / PM only. A portal customer's password is kept as
// an encrypted copy (lib/crypto.js) so it can be read back when they lose it. Every reveal/reset is
// audited. 'reset' sets a new random password and shows it once; 'reveal' returns null when no copy
// exists (customer set it before this feature, or SECRETS_KEY was not set) — use reset then.
import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, isDepartmentHead } from '@/lib/auth';
import { encryptSecret, decryptSecret } from '@/lib/crypto';
import { audit } from '@/lib/usb';
import { phonePassword } from '@/lib/portal-invite';

const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newPassword = () => Array.from(randomBytes(10), b => ALPHABET[b % ALPHABET.length]).join('');

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  if (!user || !isDepartmentHead(user, 'Sales')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { action } = await req.json();
  const login = await queryOne(
    `SELECT u.id, u.username, u.portal_password_enc FROM customers c JOIN users u ON u.id = c.portal_user_id
      WHERE c.id = ? AND u.role = 'customer'`, [params.id]);
  if (!login) return NextResponse.json({ error: 'This customer has no portal login' }, { status: 404 });

  if (action === 'reveal') {
    if (!login.portal_password_enc) return NextResponse.json({ password: null });
    let password;
    try { password = decryptSecret(login.portal_password_enc); } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }); }
    await audit('portal_password_revealed', { actor: user.username, detail: `customer #${params.id} (${login.username})` });
    return NextResponse.json({ password });
  }
  if (action === 'reset' || action === 'reset_phone') {
    let password = newPassword();
    if (action === 'reset_phone') {
      const c = await queryOne('SELECT phone FROM customers WHERE id = ?', [params.id]);
      password = phonePassword(c || {});
      if (!password) return NextResponse.json({ error: 'This customer has no usable phone number on file' }, { status: 400 });
    }
    let enc = null;
    try { enc = encryptSecret(password); } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }); }
    await execute(
      'UPDATE users SET password = ?, portal_password_enc = ?, password_setup_token = NULL, password_setup_expires = NULL WHERE id = ?',
      [bcrypt.hashSync(password, 10), enc, login.id]);
    await audit('portal_password_reset', { actor: user.username, detail: `customer #${params.id} (${login.username})${action === 'reset_phone' ? ' → phone number' : ''}` });
    return NextResponse.json({ password, username: login.username });
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
