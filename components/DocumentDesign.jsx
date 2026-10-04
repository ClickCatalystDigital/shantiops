'use client';

// The page behind Accounts → Company Entities → "Document details and design": header design first
// (components/DocumentHeadersCard.jsx), then the text every document prints for this company.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardAction, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeftIcon, FileTextIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';
import DocumentHeadersCard from '@/components/DocumentHeadersCard';

// What documents print for this company: one place, read by every PDF header (lib/company-profiles.js).
const DOC_FIELDS = [
  ['print_name', 'Name on documents', 'Blank = legal name in capitals'],
  ['registered_address', 'Address on documents'],
  ['phone', 'Phone on documents'], ['stores_email', 'Stores email (packing list)'],
  ['contact_mobile', 'Mobile'], ['contact_landline', 'Landline'], ['contact_whatsapp', 'WhatsApp'],
  ['contact_emails', 'Emails (comma separated)'], ['website', 'Website'],
  ['invoice_prefix', 'Short code (numbers, tags)'], ['maker_prefix', "Maker's number prefix"],
  ['qc_doc_prefix', 'QC document prefix'], ['qc_ref_prefix', 'QC letter reference prefix'],
  ['qc_name', 'Name on QC forms', 'Blank = legal name'], ['qc_address', 'Address on QC forms', 'Blank = address above'],
];

function DetailsCard({ entity, onSaved }) {
  const [values, setValues] = useState(entity);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setValues(entity); }, [entity]);
  async function save() {
    setSaving(true);
    try {
      await api('/api/company-settings', { method: 'PATCH', body: { id: entity.id, ...Object.fromEntries(DOC_FIELDS.map(([k]) => [k, values[k] ?? null])) } });
      showToast('Document details saved'); onSaved();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><FileTextIcon className="size-4" />Document details</CardTitle>
        <CardDescription>The name, address, contacts and codes printed on this company's documents.</CardDescription>
        <CardAction><Button size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button></CardAction>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {DOC_FIELDS.map(([key, label, hint]) => (
          <div key={key} className="grid gap-1.5">
            <Label>{label}</Label>
            <Input value={values[key] ?? ''} placeholder={hint || ''} onChange={e => setValues({ ...values, [key]: e.target.value })} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function DocumentDesign({ entity, several }) {
  const router = useRouter();
  const refresh = () => router.refresh();
  return (
    <main className="container flex flex-col gap-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Button size="sm" variant="ghost" className="-ml-2 mb-1 text-muted-foreground" asChild>
            <Link href="/accounts?tab=company-entities"><ArrowLeftIcon className="size-3.5" />Company Entities</Link>
          </Button>
          <h1 className="text-xl font-semibold">Document details and design</h1>
          <p className="text-sm text-muted-foreground">
            {entity.legal_name}{several ? '. Choose a company in the top bar to switch.' : ''}
          </p>
        </div>
      </div>
      <DocumentHeadersCard entity={entity} onSaved={refresh} />
      <DetailsCard entity={entity} onSaved={refresh} />
    </main>
  );
}
