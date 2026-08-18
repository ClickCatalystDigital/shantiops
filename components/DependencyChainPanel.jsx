'use client';

// Settings card: lets a PM record the real structural predecessor for each milestone in the
// tracker — the one input that actually resolves SYSTEM.md §5j's "Unresolved business questions"
// (the 12 intra-Production edges + the 5 other unconfirmed pairs) instead of leaving them guessed
// at plain template order forever. Editing here updates depends_on_key for that milestone_key
// across every project at once (app/api/dependency-chain/route.js) — a confirmed answer should
// take effect everywhere immediately, not per-project.
import { useState } from 'react';
import { api, showToast } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const NONE = '__none__';

export default function DependencyChainPanel({ template, current }) {
  // current: { [milestone_key]: { depends_on_key: string|null, mixed: boolean } }
  const [values, setValues] = useState(() => {
    const init = {};
    template.forEach(m => { init[m.key] = current[m.key]?.depends_on_key || NONE; });
    return init;
  });
  const [busyKey, setBusyKey] = useState(null);

  async function setDependency(milestoneKey, value) {
    const dependsOnKey = value === NONE ? null : value;
    setValues(v => ({ ...v, [milestoneKey]: value }));
    setBusyKey(milestoneKey);
    try {
      await api('/api/dependency-chain', { method: 'PATCH', body: { milestone_key: milestoneKey, depends_on_key: dependsOnKey } });
      showToast('Dependency updated — applies to every project');
    } catch (err) { showToast(err.message, 'error'); } finally { setBusyKey(null); }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Milestone Dependency Chain</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          What each milestone structurally waits on before it reads as workable
          (<code className="text-xs">blocked_by</code> on the project page — observational only,
          nothing here blocks a save). "None" means nothing structural gates it. A change applies
          to every project immediately, not just new ones.
        </p>
        <div className="flex flex-col divide-y rounded-md border">
          {template.map(m => (
            <div key={m.key} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="flex flex-col">
                <span className="text-sm">{m.label}</span>
                <span className="text-xs text-muted-foreground">
                  {m.department}
                  {current[m.key]?.mixed && <span className="text-warning"> · varies by project — pick one to standardize</span>}
                </span>
              </div>
              <Select
                value={values[m.key]}
                onValueChange={v => setDependency(m.key, v)}
                disabled={busyKey === m.key}
              >
                <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {template.filter(t => t.key !== m.key).map(t => (
                    <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
