// app/api/company-settings/[id]/eway-bill-credentials/route.js — Direct-NIC e-way-bill credential
// storage (Accounts-owned, same as every other company-entity field). GET never returns the
// credentials blob, not even masked — masking still requires holding the real value in a response;
// simplest and safest is to only ever confirm "configured" + when it was last set.
//
// Encrypted at rest (real-NIC-API research plan, Gap 6) — the stored blob is safe from the browser
// by construction (this GET never sends it back) but a plaintext JSON blob in the DB isn't safe
// from direct DB access or a backup leak. lib/crypto.js's AES-256-GCM encrypts before every write;
// only lib/eway-bill.js's real caller (once wired) ever decrypts, in memory, just before use.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { encryptSecret } from '@/lib/crypto';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;

  const company = await queryOne('SELECT company FROM company_settings WHERE id = ?', [params.id]);
  if (!company) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const row = await queryOne('SELECT updated_at FROM eway_bill_credentials WHERE company = ?', [company.company]);
  return NextResponse.json({ configured: !!row, updated_at: row?.updated_at ?? null });
}

// Reuses accounts.company_settings.write — this is a field on the same company-entity object
// Accounts already owns, not a new authority tier (unlike creating a whole new company).
export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Accounts', 'accounts.company_settings.write');
  if (actionDenied) return actionDenied;

  const company = await queryOne('SELECT company FROM company_settings WHERE id = ?', [params.id]);
  if (!company) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const { client_id, client_secret, api_username, api_password } = b;
  if (!client_id || !client_secret || !api_username || !api_password) {
    return NextResponse.json({ error: 'client_id, client_secret, api_username, and api_password are all required' }, { status: 400 });
  }
  const plaintext = JSON.stringify({ client_id, client_secret, api_username, api_password });

  // Fails closed (no fallback to plaintext storage) if EWAY_BILL_CREDENTIALS_KEY isn't set — same
  // "no workarounds" principle lib/mail.js already established for its own unwired provider seam.
  let credentials;
  try {
    credentials = encryptSecret(plaintext);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }

  await execute(
    `INSERT INTO eway_bill_credentials (company, credentials, updated_by) VALUES (?, ?, ?)
     ON CONFLICT(company) DO UPDATE SET credentials = excluded.credentials, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`,
    [company.company, credentials, user.username]
  );
  // Never log the blob itself — company + who touched it only.
  await audit('eway_bill_credentials_updated', { actor: user.username, detail: company.company });
  return NextResponse.json({ ok: true });
}
