'use client';

// Settings card: per-milestone Auto-start/Auto-complete toggles — the real business-rule control
// behind lib/milestone-auto.js's automation (mirrors components/ActionPermissionsPanel.jsx's shape:
// no row yet = both enabled, same open-by-default precedent). Only the milestone keys that have real
// automation appear here (lib/milestone-auto.js's MILESTONE_AUTOMATION_CATALOG) — everything else
// (Design, Release BOM/PR, Site Installation, Commissioning) has no automation to toggle at all.
import { useState } from 'react';
import { api, showToast } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';

export default function MilestoneAutomationPanel({ catalog, current: initial }) {
  const [rows, setRows] = useState(initial);

  function valueFor(key, field) {
    const row = rows.find(r => r.milestone_key === key);
    return row ? !!row[field] : true; // no row yet = enabled
  }

  async function setField(key, field, value) {
    const autoStart = field === 'auto_start' ? value : valueFor(key, 'auto_start');
    const autoComplete = field === 'auto_complete' ? value : valueFor(key, 'auto_complete');
    setRows(prev => {
      const next = prev.filter(r => r.milestone_key !== key);
      next.push({ milestone_key: key, auto_start: autoStart, auto_complete: autoComplete });
      return next;
    });
    try {
      await api('/api/milestone-automation', {
        method: 'PATCH',
        body: { milestone_key: key, auto_start: autoStart, auto_complete: autoComplete },
      });
    } catch (err) { showToast(err.message, 'error'); }
  }

  if (!catalog.length) return null;

  return (
    <Card>
      <CardHeader><CardTitle>Milestone Automation</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          These milestones move on their own when the real work happens — a drawing gets approved, a
          BOM line clears a procurement step, a Job Card stage is QC-signed. Turn either off to make
          that milestone fully manual again; it never overwrites a status someone already set by hand.
        </p>
        <div className="flex flex-col divide-y rounded-md border">
          <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs font-medium text-muted-foreground">
            <span>Milestone</span>
            <div className="flex gap-6">
              <span className="w-20 text-center">Auto-start</span>
              <span className="w-24 text-center">Auto-complete</span>
            </div>
          </div>
          {catalog.map(m => (
            <div key={m.key} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="text-sm">{m.label} <span className="text-xs text-muted-foreground">· {m.department}</span></span>
              <div className="flex gap-6">
                <div className="flex w-20 justify-center">
                  <Checkbox checked={valueFor(m.key, 'auto_start')} onCheckedChange={v => setField(m.key, 'auto_start', !!v)} />
                </div>
                <div className="flex w-24 justify-center">
                  <Checkbox checked={valueFor(m.key, 'auto_complete')} onCheckedChange={v => setField(m.key, 'auto_complete', !!v)} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
