// Settings → Sales → WhatsApp: connect one WhatsApp Business number per company (Meta Cloud API).
// Sales Head or a PM. The access token and app secret are stored encrypted and never returned.
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { queryAll, queryOne, execute } from '@/lib/db';
import { getFreshSessionUser, isDepartmentHead } from '@/lib/auth';
import { encryptSecret, decryptSecret } from '@/lib/crypto';
import { fetchNumber } from '@/lib/whatsapp';
import { audit } from '@/lib/usb';

const deny = () => NextResponse.json({ error: 'Only the Sales Head can set up WhatsApp' }, { status: 403 });
const canManage = user => !!user && isDepartmentHead(user, 'Sales');

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!canManage(user)) return deny();
  const origin = (process.env.RENDER_EXTERNAL_URL || new URL(req.url).origin).replace(/\/$/, '');
  const [companies, accounts] = await Promise.all([
    queryAll('SELECT company FROM company_settings ORDER BY company'),
    queryAll('SELECT * FROM whatsapp_accounts'),
  ]);
  return NextResponse.json({
    webhook_url: `${origin}/api/whatsapp/webhook`,
    companies: companies.map(c => {
      const a = accounts.find(x => x.company === c.company);
      return { company: c.company, account: a ? {
        phone_number_id: a.phone_number_id, waba_id: a.waba_id, display_phone: a.display_phone, verified_name: a.verified_name,
        verify_token: a.verify_token, enabled: !!a.enabled, has_app_secret: !!a.app_secret_enc, last_test_at: a.last_test_at, last_error: a.last_error,
      } : null };
    }),
  });
}

// { company, phone_number_id, waba_id, token?, app_secret?, enabled? } — the number is checked with Meta before saving.
export async function PUT(req) {
  const user = await getFreshSessionUser();
  if (!canManage(user)) return deny();
  const b = await req.json();
  if (!(await queryOne('SELECT 1 FROM company_settings WHERE company = ?', [b.company]))) return NextResponse.json({ error: 'Unknown company' }, { status: 400 });
  const existing = await queryOne('SELECT * FROM whatsapp_accounts WHERE company = ?', [b.company]);
  if (existing && b.enabled !== undefined && !b.phone_number_id) {
    await execute('UPDATE whatsapp_accounts SET enabled = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [b.enabled ? 1 : 0, user.username, existing.id]);
    return NextResponse.json({ ok: true });
  }
  const phoneId = String(b.phone_number_id || '').trim(), wabaId = String(b.waba_id || '').trim();
  const token = String(b.token || '').trim(), secret = String(b.app_secret || '').trim();
  if (!/^\d+$/.test(phoneId) || !/^\d+$/.test(wabaId)) return NextResponse.json({ error: 'Phone number ID and WhatsApp Business Account ID are both numbers — copy them from Meta\'s API Setup page' }, { status: 400 });
  if (!token && !existing) return NextResponse.json({ error: 'Paste the access token' }, { status: 400 });
  // The app secret is what proves an incoming message really came from Meta — never optional.
  if (!secret && !existing?.app_secret_enc) return NextResponse.json({ error: 'Paste the app secret' }, { status: 400 });
  const other = await queryOne('SELECT company FROM whatsapp_accounts WHERE phone_number_id = ? AND company != ?', [phoneId, b.company]);
  if (other) return NextResponse.json({ error: `This number is already connected to ${other.company}` }, { status: 409 });

  let info;
  try { info = await fetchNumber(token || decryptSecret(existing.token_enc), phoneId); }
  catch (e) { return NextResponse.json({ error: e.message }, { status: 400 }); }
  let tokenEnc, secretEnc;
  try {
    tokenEnc = token ? encryptSecret(token) : existing.token_enc;
    secretEnc = secret ? encryptSecret(secret) : (existing?.app_secret_enc || null);
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }); }

  if (existing) {
    await execute(
      `UPDATE whatsapp_accounts SET phone_number_id = ?, waba_id = ?, display_phone = ?, verified_name = ?, token_enc = ?, app_secret_enc = ?,
         enabled = 1, last_test_at = CURRENT_TIMESTAMP, last_error = NULL, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [phoneId, wabaId, info.display_phone_number || null, info.verified_name || null, tokenEnc, secretEnc, user.username, existing.id]);
  } else {
    await execute(
      `INSERT INTO whatsapp_accounts (company, phone_number_id, waba_id, display_phone, verified_name, token_enc, app_secret_enc, verify_token, last_test_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
      [b.company, phoneId, wabaId, info.display_phone_number || null, info.verified_name || null, tokenEnc, secretEnc, crypto.randomBytes(16).toString('hex'), user.username]);
  }
  await audit('whatsapp_account_saved', { actor: user.username, detail: `${b.company} · ${info.display_phone_number || phoneId}` });
  return NextResponse.json({ ok: true, display_phone: info.display_phone_number, verified_name: info.verified_name });
}

// { company } — check the connection now.
export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!canManage(user)) return deny();
  const b = await req.json();
  const a = await queryOne('SELECT * FROM whatsapp_accounts WHERE company = ?', [b.company]);
  if (!a) return NextResponse.json({ error: 'Connect a number first' }, { status: 400 });
  try {
    const info = await fetchNumber(decryptSecret(a.token_enc), a.phone_number_id);
    await execute('UPDATE whatsapp_accounts SET display_phone = ?, verified_name = ?, last_test_at = CURRENT_TIMESTAMP, last_error = NULL WHERE id = ?',
      [info.display_phone_number || a.display_phone, info.verified_name || a.verified_name, a.id]);
    return NextResponse.json({ ok: true, display_phone: info.display_phone_number, quality: info.quality_rating });
  } catch (e) {
    await execute('UPDATE whatsapp_accounts SET last_test_at = CURRENT_TIMESTAMP, last_error = ? WHERE id = ?', [e.message, a.id]);
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}

// { company } — disconnect. Refused once conversations exist (they belong to this number); pause instead.
export async function DELETE(req) {
  const user = await getFreshSessionUser();
  if (!canManage(user)) return deny();
  const b = await req.json();
  const a = await queryOne('SELECT id FROM whatsapp_accounts WHERE company = ?', [b.company]);
  if (!a) return NextResponse.json({ ok: true });
  if (await queryOne('SELECT 1 FROM wa_conversations WHERE account_id = ? LIMIT 1', [a.id])) {
    return NextResponse.json({ error: 'This number has conversations — pause it instead, so the history stays' }, { status: 409 });
  }
  await execute('DELETE FROM whatsapp_accounts WHERE id = ?', [a.id]);
  await audit('whatsapp_account_removed', { actor: user.username, detail: b.company });
  return NextResponse.json({ ok: true });
}
