import { NextResponse } from 'next/server';
import { queryOne, execute } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { audit } from '@/lib/usb';
import { err, qcOnly } from '@/lib/quality-routes';

export async function POST(_req, props) {
  const params = await props.params;
  const user = await getFreshSessionUser();
  const denied = await qcOnly(user, 'qc.rule.write');
  if (denied) return denied;
  const r = await queryOne('SELECT rule_key, version FROM acceptance_rules WHERE id = ?', [params.id]);
  if (!r) return err('Not found', 404);
  const x = await execute('UPDATE acceptance_rules SET retired_at = CURRENT_TIMESTAMP WHERE id = ? AND retired_at IS NULL', [params.id]);
  if (!x.changes) return err('Already retired', 409);
  await audit('acceptance_rule_retired', { actor: user.username, detail: `${r.rule_key} v${r.version}` });
  return NextResponse.json({ ok: true });
}
