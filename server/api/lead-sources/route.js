// Marketing → Lead sources: connect IndiaMART / TradeIndia (credentials, encrypted) and JustDial /
// website forms (a secret address they push to), per company. Marketing Head, Sales Head or a PM.
// Credentials are never returned — only whether a source is connected, and how its last pull went.
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { queryAll, queryOne, execute } from '@/lib/db';
import { getFreshSessionUser, isDepartmentHead } from '@/lib/auth';
import { encryptSecret } from '@/lib/crypto';
import { LEAD_SOURCES } from '@/lib/lead-sources.mjs';
import { syncAccount } from '@/lib/lead-sync';
import { audit } from '@/lib/usb';

const canManage = user => !!user && (isDepartmentHead(user, 'Marketing') || isDepartmentHead(user, 'Sales'));
const deny = () => NextResponse.json({ error: 'Only the Marketing or Sales Head can manage lead sources' }, { status: 403 });

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!canManage(user)) return deny();
  const origin = (process.env.RENDER_EXTERNAL_URL || new URL(req.url).origin).replace(/\/$/, '');
  const [companies, accounts] = await Promise.all([
    queryAll('SELECT company, legal_name FROM company_settings ORDER BY company'),
    queryAll('SELECT * FROM lead_source_accounts'),
  ]);
  return NextResponse.json({
    sources: Object.entries(LEAD_SOURCES).map(([key, s]) => ({ key, ...s })),
    companies: companies.map(c => ({
      company: c.company, legal_name: c.legal_name,
      accounts: Object.fromEntries(accounts.filter(a => a.company === c.company).map(a => [a.source, {
        connected: LEAD_SOURCES[a.source]?.kind === 'push' ? !!a.webhook_token : !!a.credentials_enc,
        enabled: !!a.enabled, last_sync_at: a.last_sync_at, last_success_at: a.last_success_at, last_error: a.last_error,
        last_added: a.last_added, total_added: a.total_added,
        hook_url: a.webhook_token ? `${origin}/api/lead-hooks/${a.webhook_token}` : null,
      }])),
    })),
  });
}

// { company, source, credentials?: {...}, enabled?: bool } — connect / update / pause.
export async function PUT(req) {
  const user = await getFreshSessionUser();
  if (!canManage(user)) return deny();
  const b = await req.json();
  const meta = LEAD_SOURCES[b.source];
  if (!meta) return NextResponse.json({ error: 'Unknown lead source' }, { status: 400 });
  if (!(await queryOne('SELECT 1 FROM company_settings WHERE company = ?', [b.company]))) return NextResponse.json({ error: 'Unknown company' }, { status: 400 });
  const existing = await queryOne('SELECT * FROM lead_source_accounts WHERE company = ? AND source = ?', [b.company, b.source]);

  let credsEnc = existing?.credentials_enc || null;
  if (meta.kind === 'pull' && b.credentials) {
    const creds = {};
    for (const f of meta.fields) {
      const v = String(b.credentials[f.key] || '').trim();
      if (!v) return NextResponse.json({ error: `${f.label} is required` }, { status: 400 });
      creds[f.key] = v;
    }
    try { credsEnc = encryptSecret(JSON.stringify(creds)); } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }); }
  }
  if (meta.kind === 'pull' && !credsEnc) return NextResponse.json({ error: 'Enter the credentials to connect' }, { status: 400 });
  const token = meta.kind === 'push' ? (existing?.webhook_token || crypto.randomBytes(24).toString('hex')) : null;
  const enabled = b.enabled === undefined ? (existing ? existing.enabled : 1) : (b.enabled ? 1 : 0);

  if (existing) {
    await execute(
      `UPDATE lead_source_accounts SET credentials_enc = ?, webhook_token = ?, enabled = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP,
         last_error = CASE WHEN ? THEN NULL ELSE last_error END WHERE id = ?`,
      [credsEnc, token, enabled, user.username, b.credentials ? 1 : 0, existing.id]);
  } else {
    await execute('INSERT INTO lead_source_accounts (company, source, credentials_enc, webhook_token, enabled, updated_by) VALUES (?, ?, ?, ?, ?, ?)',
      [b.company, b.source, credsEnc, token, enabled, user.username]);
  }
  await audit('lead_source_saved', { actor: user.username, detail: `${meta.label} · ${b.company}${b.credentials ? ' (credentials changed)' : ''}${b.enabled === false ? ' (paused)' : ''}` });
  return NextResponse.json({ ok: true });
}

// { company, source } — pull now (also the "Test" button: a wrong key comes back as the provider's own error).
export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!canManage(user)) return deny();
  const b = await req.json();
  const account = await queryOne('SELECT * FROM lead_source_accounts WHERE company = ? AND source = ?', [b.company, b.source]);
  if (!account) return NextResponse.json({ error: 'Connect this source first' }, { status: 400 });
  if (LEAD_SOURCES[account.source]?.kind !== 'pull') return NextResponse.json({ error: 'This source sends leads by itself — nothing to pull' }, { status: 400 });
  const result = await syncAccount(account);
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}

// { company, source } — disconnect: forget the credentials / address. Leads already received stay.
export async function DELETE(req) {
  const user = await getFreshSessionUser();
  if (!canManage(user)) return deny();
  const b = await req.json();
  const account = await queryOne('SELECT id FROM lead_source_accounts WHERE company = ? AND source = ?', [b.company, b.source]);
  if (account) await execute('DELETE FROM lead_source_accounts WHERE id = ?', [account.id]);
  await audit('lead_source_removed', { actor: user.username, detail: `${b.source} · ${b.company}` });
  return NextResponse.json({ ok: true });
}
