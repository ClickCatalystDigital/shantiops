import { NextResponse } from 'next/server';
import { execute, queryAll } from '@/lib/db';
import { getFreshSessionUser, requirePM } from '@/lib/auth';
import { MILESTONE_TEMPLATE } from '@/lib/milestones';
import { audit } from '@/lib/usb';

// PM-only, same tier as Action Permissions — this is what lets a Production head's confirmed
// answer (SYSTEM.md §5j "Unresolved business questions") actually become the real structural
// chain lib/dependency.mjs reads, instead of staying stuck at the plain template-order guess
// createProjectMilestones originally seeded it with. Global by design: one edit here updates
// depends_on_key for that milestone_key across every project at once (not just future ones) — a
// PM confirming "drilling doesn't really wait on marking_cutting" should take effect everywhere
// immediately, not per-project. createProjectMilestones reads this table's current state
// (currentDependsOnKeyMap in lib/db.js) to seed every new project from here on, so this really is
// the one source of truth now, not just existing projects.
const VALID_KEYS = new Set(MILESTONE_TEMPLATE.map(m => m.key));

export async function PATCH(req) {
  const user = await getFreshSessionUser();
  const denied = requirePM(user);
  if (denied) return denied;

  const b = await req.json();
  const milestoneKey = String(b.milestone_key || '');
  const dependsOnKey = b.depends_on_key ? String(b.depends_on_key) : null;

  if (!VALID_KEYS.has(milestoneKey)) return NextResponse.json({ error: 'Unknown milestone' }, { status: 400 });
  if (dependsOnKey && !VALID_KEYS.has(dependsOnKey)) return NextResponse.json({ error: 'Unknown predecessor' }, { status: 400 });
  if (dependsOnKey === milestoneKey) return NextResponse.json({ error: 'A milestone cannot depend on itself' }, { status: 400 });

  if (dependsOnKey) {
    // Cycle guard: walk the chain as it would read AFTER this edit (substituting the new value in),
    // starting from the proposed predecessor. If it ever leads back to milestoneKey, reject —
    // milestoneReadiness() itself only ever looks one hop up, so a cycle wouldn't crash it, but it
    // would leave two milestones permanently and confusingly "blocked by" each other.
    const rows = await queryAll('SELECT DISTINCT milestone_key, depends_on_key FROM milestones');
    const chain = new Map(rows.map(r => [r.milestone_key, r.depends_on_key]));
    chain.set(milestoneKey, dependsOnKey);
    let cursor = dependsOnKey;
    for (let hops = 0; hops < MILESTONE_TEMPLATE.length && cursor; hops++) {
      if (cursor === milestoneKey) return NextResponse.json({ error: 'That would create a dependency cycle' }, { status: 400 });
      cursor = chain.get(cursor) ?? null;
    }
  }

  const { changes } = await execute(
    'UPDATE milestones SET depends_on_key = ? WHERE milestone_key = ?',
    [dependsOnKey, milestoneKey]
  );
  await audit('dependency_chain_edit', {
    actor: user.username,
    detail: `${milestoneKey} depends_on_key -> ${dependsOnKey || '(none)'} (${changes} row(s), all projects)`,
  });
  return NextResponse.json({ ok: true, changes });
}
