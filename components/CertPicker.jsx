// components/CertPicker.jsx

'use client';

// Link picker — the document editor's core interaction. Cert + cast + plate are always shown
// together (QC-CHANGES.md §2: certificate number alone is ambiguous — one real cert in the sample
// covers 4 different casts), and certificates already used elsewhere in this document float first,
// since the same certificate typically backs several parts. "+ Add certificate" keeps the hard gate
// from ever being a dead end.
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PlusIcon, SearchIcon } from 'lucide-react';
import CertForm from './CertForm';

function sizeText(c) {
  return [c.size_t, c.size_w, c.size_l].filter(Boolean).join(' × ') || '—';
}

function CertOption({ c, onClick }) {
  return (
    <button onClick={onClick} className="flex w-full flex-col gap-0.5 rounded-md p-2 text-left text-sm hover:bg-muted">
      <span className="font-medium">{c.certificate_no} · {c.cast_no}{c.plate_no ? ` · ${c.plate_no}` : ''}</span>
      <span className="text-xs text-muted-foreground">{c.material_spec} · {c.steel_maker} · {sizeText(c)}</span>
    </button>
  );
}

const TIER_BADGE = {
  promoted: { label: '✓✓', title: 'Previously approved 3+ times for this material — confirm before using' },
  exact: { label: '✓', title: 'Material spec matches the linked BOM item — confirm before using' },
  fuzzy: { label: '≈', title: 'Partial match, not binding — confirm before using' },
};

// lib/tc-match.js's suggestCertificates() output — a non-binding nudge, same "confirm before
// reserving" idiom as StoresWorkspace.jsx's possibleMatches() badges. Additive only: renders above
// the untouched search list below, never replaces it.
function SuggestionChips({ suggestions, onPick }) {
  if (!suggestions.length) return null;
  return (
    <div className="flex flex-col gap-1 rounded-md border bg-muted/30 p-2">
      <p className="text-xs font-medium text-muted-foreground">SUGGESTED</p>
      {suggestions.map(({ certificate: c, tier }) => {
        const badge = TIER_BADGE[tier];
        return (
          <div key={c.id} className="flex items-center justify-between gap-2 rounded-md p-1.5 text-sm hover:bg-muted">
            <div className="flex min-w-0 flex-col">
              <span className="font-medium" title={badge.title}>
                <span className="mr-1">{badge.label}</span>
                {c.certificate_no} · {c.cast_no}{c.plate_no ? ` · ${c.plate_no}` : ''}
              </span>
              <span className="truncate text-xs text-muted-foreground">{c.material_spec} · {c.steel_maker} · {sizeText(c)}</span>
            </div>
            <Button size="xs" variant="outline" onClick={() => onPick(c)}>Use this certificate</Button>
          </div>
        );
      })}
    </div>
  );
}

export default function CertPicker({ open, onOpenChange, title, certificates = [], project = null, usedIds = new Set(), suggestions = [], onPick }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [formOpen, setFormOpen] = useState(false);

  const needle = q.trim().toLowerCase();
  const filtered = certificates.filter(c => !needle || [
    c.certificate_no, c.cast_no, c.plate_no, c.steel_maker, c.material_spec,
  ].some(v => v?.toLowerCase().includes(needle)));
  const used = filtered.filter(c => usedIds.has(c.id));
  const rest = filtered.filter(c => !usedIds.has(c.id));

  function pick(cert) {
    onPick(cert.id);
    onOpenChange(false);
    setQ('');
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
          <SuggestionChips suggestions={suggestions} onPick={pick} />
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search cert · cast · plate · maker" className="pl-8" autoFocus />
          </div>
          <div className="flex max-h-80 flex-col gap-3 overflow-y-auto">
            {used.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-xs font-medium text-muted-foreground">USED IN THIS DOCUMENT</p>
                {used.map(c => <CertOption key={c.id} c={c} onClick={() => pick(c)} />)}
              </div>
            )}
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-muted-foreground">ALL CERTIFICATES ({filtered.length})</p>
              {rest.length === 0 && used.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">No matches.</p>
              )}
              {rest.map(c => <CertOption key={c.id} c={c} onClick={() => pick(c)} />)}
            </div>
          </div>
          <div className="-mx-4 -mb-4 flex items-center justify-between rounded-b-xl border-t bg-muted/50 p-4 text-sm">
            <span className="text-muted-foreground">Not in the bank?</span>
            <Button size="sm" variant="outline" onClick={() => setFormOpen(true)}>
              <PlusIcon data-icon="inline-start" />Add certificate
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <CertForm
        open={formOpen}
        onOpenChange={setFormOpen}
        certificates={certificates}
        projects={project ? [project] : []}
        defaultProjectIds={project ? [project.id] : []}
        router={router}
        onSaved={cert => pick(cert)}
      />
    </>
  );
}
