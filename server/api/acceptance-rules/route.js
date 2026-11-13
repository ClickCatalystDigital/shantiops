// Acceptance rules: limits a measured value is checked against (lib/acceptance.mjs). Every rule names its
// source; the app holds no limits of its own. A rule is never edited: a change is a new version, so a
// result keeps the rule it was judged by.
import { NextResponse } from 'next/server';
import { queryAll, execute } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { audit } from '@/lib/usb';
import { canRead, forbidden, err, qcOnly } from '@/lib/quality-routes';
import { cleanRule } from '@/lib/rule-input.mjs';

export async function GET() {
  const user = await getFreshSessionUser();
  if (!canRead(user)) return forbidden();
  return NextResponse.json(await queryAll('SELECT * FROM acceptance_rules ORDER BY rule_key, version DESC'));
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = await qcOnly(user, 'qc.rule.write');
  if (denied) return denied;
  const { rule, error } = cleanRule(await req.json());
  if (error) return err(error);
  const key = `${rule.characteristic}|${rule.scope}|${rule.scope_value || ''}`.toLowerCase();
  const live = await queryAll('SELECT 1 FROM acceptance_rules WHERE rule_key = ? AND retired_at IS NULL', [key]);
  if (live.length) return err('A rule for this characteristic and scope exists: revise it instead', 409);
  const v = (await queryAll('SELECT COALESCE(MAX(version), 0) AS v FROM acceptance_rules WHERE rule_key = ?', [key]))[0].v;
  const r = await execute(`INSERT INTO acceptance_rules (rule_key, version, characteristic, min, max, min_inclusive, max_inclusive, unit,
    scope, scope_value, source, edition, effective_from, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [key, Number(v) + 1, rule.characteristic, rule.min, rule.max, rule.min_inclusive, rule.max_inclusive, rule.unit,
      rule.scope, rule.scope_value, rule.source, rule.edition, rule.effective_from, user.username]);
  await audit('acceptance_rule_added', { actor: user.username, detail: JSON.stringify({ key, ...rule }) });
  return NextResponse.json({ id: Number(r.lastId) });
}
