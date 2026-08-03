'use client';

// Test Certificate bank (/qc) — cross-project, QC-department-gated (Nav.jsx). Two-line list rows,
// not a wide table: 13 chemistry/physical columns won't fit any screen, same reasoning as QcPanel's
// list idiom. Search filters client-side over the whole (small, ~17-row) bank, same pattern as
// ProcurementWorkspace's shared search input.
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PlusIcon, SearchIcon, ChevronRightIcon } from 'lucide-react';
import CertForm from './CertForm';

function sizeText(c) {
  return [c.size_t, c.size_w, c.size_l].filter(Boolean).join(' × ') || '—';
}

function CertRow({ c, onClick }) {
  return (
    <button onClick={onClick} className="flex w-full flex-col gap-1 py-2.5 text-left text-sm hover:bg-muted/50">
      <div className="flex items-center gap-2">
        <span className="font-medium">{c.certificate_no}</span>
        <span className="text-muted-foreground">cast {c.cast_no}</span>
        {c.plate_no && <span className="text-muted-foreground">plate {c.plate_no}</span>}
        <ChevronRightIcon className="ml-auto size-4 text-muted-foreground" />
      </div>
      <p className="text-xs text-muted-foreground">{c.material_spec} · {c.steel_maker} · {sizeText(c)}</p>
      <p className="text-xs text-muted-foreground">
        C {c.chem_c} Mn {c.chem_mn} P {c.chem_p} S {c.chem_s} Si {c.chem_si}
        {' · '}Y.S {c.ys} UTS {c.uts} El {c.elongation}% · {c.bend_test}
      </p>
      <p className="text-xs text-muted-foreground">
        used in {c.used_in_parts} part{c.used_in_parts === 1 ? '' : 's'}
      </p>
    </button>
  );
}

export default function TcBank({ certificates = [] }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const needle = q.trim().toLowerCase();
  const shown = certificates.filter(c => !needle || [
    c.certificate_no, c.cast_no, c.plate_no, c.steel_maker, c.material_spec,
  ].some(v => v?.toLowerCase().includes(needle)));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Test Certificates</CardTitle>
        <CardAction>
          <Button size="sm" variant="outline" onClick={() => { setEditing(null); setFormOpen(true); }}>
            <PlusIcon data-icon="inline-start" />Add Certificate
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search cert · cast · plate · maker" className="pl-8" />
        </div>
        <p className="text-xs text-muted-foreground">
          {shown.length} of {certificates.length} certificate{certificates.length === 1 ? '' : 's'}
        </p>
        <div className="flex flex-col divide-y">
          {shown.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {certificates.length === 0
                ? 'No certificates yet — add the first one before filing a statutory document.'
                : 'No matches.'}
            </p>
          )}
          {shown.map(c => (
            <CertRow key={c.id} c={c} onClick={() => { setEditing(c); setFormOpen(true); }} />
          ))}
        </div>
      </CardContent>
      <CertForm
        open={formOpen}
        onOpenChange={setFormOpen}
        certificate={editing}
        certificates={certificates}
        router={router}
      />
    </Card>
  );
}
