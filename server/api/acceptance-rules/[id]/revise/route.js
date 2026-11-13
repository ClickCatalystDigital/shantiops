// New version of a rule (same characteristic and scope). The old version is retired, not changed.
import { NextResponse } from 'next/server';
import { queryOne, withTransaction } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { audit } from '@/lib/usb';
import { err, qcOnly } from '@/lib/quality-routes';
import { cleanRule } from '@/lib/rule-input.mjs';

export async function POST(req, props) {
  const params = await props.params;
  const user = await getFreshSessionUser();
  const denied = await qcOnly(user, 'qc.rule.write');
  if (denied) return denied;
  const old = await queryOne('SELECT * FROM acceptance_rules WHERE id = ?', [params.id]);
  if (!old) return err('Not found', 404);
  if (old.retired_at) return err('Only the current version can be revised', 409);
  const b = await req.json();
  const { rule, error } = cleanRule({ ...b, characteristic: old.characteristic, scope: old.scope, scope_value: old.scope_value });
  if (error) return err(error);
  const id = await withTransaction(async tx => {
    const r0 = await tx.execute({ sql: 'UPDATE acceptance_rules SET retired_at = CURRENT_TIMESTAMP WHERE id = ? AND retired_at IS NULL', args: [old.id] });
    if (!r0.rowsAffected) throw Object.assign(new Error('Revised by someone else just now'), { status: 409 });
    const r = await tx.execute({ sql: `INSERT INTO acceptance_rules (rule_key, version, characteristic, min, max, min_inclusive, max_inclusive, unit,
      scope, scope_value, source, edition, effective_from, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [old.rule_key, old.version + 1, old.characteristic, rule.min, rule.max, rule.min_inclusive, rule.max_inclusive, rule.unit,
        old.scope, old.scope_value, rule.source, rule.edition, rule.effective_from, user.username] });
    return Number(r.lastInsertRowid);
  }).catch(e => (e.status === 409 ? null : Promise.reject(e)));
  if (!id) return err('Revised by someone else just now', 409);
  await audit('acceptance_rule_revised', { actor: user.username, detail: JSON.stringify({ key: old.rule_key, from: old.version, to: old.version + 1, ...rule }) });
  return NextResponse.json({ id });
}
