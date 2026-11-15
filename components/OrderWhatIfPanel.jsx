'use client';

// Steel purchase timing what-if (market-intel plan D6). Read-only and local: the figures typed here stay in this browser tab; nothing is
// saved, sent or looked up, and no model is involved. The arithmetic is lib/order-whatif.mjs, the port of the shared calculation that
// lib/mechanisms-selfcheck.mjs and lib/order-whatif-selfcheck.mjs keep in parity with the reference vectors. Steel cost and financing
// cost are shown as separate amounts and never added together; no percentage of margin is computed.
import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Button } from './ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { DEFAULT_FORM, FIELDS, runForm } from '@/lib/order-whatif-form.mjs';

// One result line: the label, then the amount. On a narrow screen the amount wraps below the label (still right-aligned) instead of
// being pushed off-screen, so every amount is visible without scrolling sideways.
const Line = ({ label, value, testid }) => (
  <div data-testid={testid} className="flex flex-wrap items-baseline gap-x-4 border-b py-1.5 last:border-0">
    <span className="min-w-0 flex-1">{label}</span>
    <span className="ml-auto whitespace-nowrap font-medium tabular-nums">{value}</span>
  </div>
);

// What version 1 leaves out (market-intel docs/sbops-merge-readiness.md §4). Shown with every result, not hidden in a document.
export const LIMITS = [
  'Cash in hand earns nothing here. If you borrow elsewhere, using the advance to buy steel early costs more than shown.',
  'The cash timeline values the steel at the quoted rate, so the interest on a price difference is not included.',
  'Supplier credit, storage and handling costs, and the value of securing supply early are not included.',
  'The later rates are the ones you typed, not a forecast. Use these amounts to compare options, not as a recommendation.',
];

const money = (x, cur) => `${Number(x).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;

export default function OrderWhatIfPanel({ projectNo }) {
  const [form, setForm] = useState(DEFAULT_FORM);
  const out = useMemo(() => runForm(form), [form]);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const r = out.ok ? out.result : null;
  const cur = r?.currency;

  return (
    <Card data-testid="order-whatif">
      <CardHeader>
        <CardTitle>Steel purchase timing (what-if)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          Compares paying for the open steel now with paying when fabrication starts{projectNo ? ` on ${projectNo}` : ''}, delivery fixed. Amounts only:
          the steel cost and the financing cost are separate lines and are not added together. No percentage of margin is computed. Nothing you type is saved or sent.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-medium">These figures are:</span>
          {['hypothetical', 'customer_entered'].map((l) => (
            <label key={l} className="flex items-center gap-1">
              <input type="radio" name="whatif-label" checked={form.label === l} onChange={() => setForm({ ...form, label: l })} />
              {l === 'hypothetical' ? 'hypothetical (example)' : 'entered by me for this order'}
            </label>
          ))}
          <Button size="sm" variant="outline" type="button" onClick={() => setForm(DEFAULT_FORM)}>Reset to the invented example</Button>
        </div>
        {form.label === 'hypothetical' && <p className="rounded bg-amber-50 p-2 text-amber-900">The starting figures are invented for illustration. They are not this project's figures.</p>}

        <div className="grid gap-4 lg:grid-cols-2">
          {Object.entries(FIELDS).map(([group, fields]) => (
            <fieldset key={group} className="space-y-2 rounded border p-3">
              <legend className="px-1 font-medium">{group}</legend>
              {fields.map(([k, label, help]) => (
                <div key={k} className="grid grid-cols-[1fr_9rem] items-center gap-2">
                  <Label htmlFor={`whatif-${k}`}>{label} <span className="text-muted-foreground">({help})</span></Label>
                  <Input id={`whatif-${k}`} value={form[k]} onChange={set(k)} inputMode={k === 'unit' || k === 'currency' ? 'text' : 'decimal'} />
                </div>
              ))}
            </fieldset>
          ))}
        </div>

        {!out.ok && <p role="alert" className="rounded bg-red-50 p-2 text-red-800">Cannot compute: {out.error}</p>}
        {r && (
          <div className="space-y-4">
            <p className="font-medium">{r.header}</p>
            <div data-testid="whatif-limits" className="rounded border border-amber-200 bg-amber-50 p-2 text-amber-900">
              <p className="font-medium">Limits of this calculation (version {r.lines.financing_cost.mechanism})</p>
              <ul className="ml-4 list-disc">{LIMITS.map((l) => <li key={l}>{l}</li>)}</ul>
            </div>
            <div>
              <h4 className="font-medium">1. Steel cost above the quoted rate ({r.lines.steel_cost.posts_to}; {r.lines.steel_cost.mechanism})</h4>
              <Table>
                <TableHeader><TableRow><TableHead>Case</TableHead><TableHead className="text-right">Rate paid</TableHead><TableHead className="text-right">Extra cost vs quote</TableHead></TableRow></TableHeader>
                <TableBody>
                  {Object.entries(r.lines.steel_cost.rows).map(([k, v]) => (
                    <TableRow key={k}><TableCell>{k}</TableCell><TableCell className="text-right">{v.rate.toLocaleString('en-IN')}</TableCell><TableCell className="text-right">{money(v.extra_material_cost, cur)}</TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div>
              <h4 className="font-medium">2. Financing cost of the cash gap ({r.lines.financing_cost.posts_to}; {r.lines.financing_cost.mechanism})</h4>
              {Object.entries(r.lines.financing_cost.rows).map(([rate, rows]) => (
                <div key={rate} className="mt-2">
                  <p className="text-muted-foreground">At {rate}</p>
                  {Object.entries(rows).map(([when, v]) => (
                    <div key={when} className="mt-1 rounded border p-2">
                      <p className="font-medium">{when === 'steel paid now' ? 'Steel paid now' : 'Steel paid when fabrication starts'}</p>
                      <Line testid="whatif-amount" label="Financing cost" value={money(v.financing_cost, cur)} />
                      <Line label="Peak cash need (not a cost)" value={money(v.peak_cash_need, cur)} />
                      <Line label="Months with a negative balance" value={v.months_negative} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div>
              <h4 className="font-medium">3. Comparison (each amount stands alone; they are not added together)</h4>
              <p className="mt-2 text-muted-foreground">Steel cost of waiting instead of buying now (positive = waiting costs more)</p>
              {Object.entries(r.comparison.steel_cost_of_waiting_instead_of_buying_now).map(([k, v]) => (
                <Line key={'s' + k} testid="whatif-amount" label={`If the later rate is ${k}`} value={money(v, cur)} />
              ))}
              <p className="mt-2 text-muted-foreground">Extra financing cost of buying now instead of waiting (positive = buying now costs more interest)</p>
              {Object.entries(r.comparison.extra_financing_cost_of_buying_now_instead_of_waiting).map(([k, v]) => (
                <Line key={'f' + k} testid="whatif-amount" label={`At ${k}`} value={money(v, cur)} />
              ))}
            </div>
            <div>
              <h4 className="font-medium">Where every input came from</h4>
              <Table>
                <TableBody>
                  {Object.entries(r.input_sources).map(([k, v]) => <TableRow key={k}><TableCell>{k}</TableCell><TableCell>{v.replace('_', ' ')}</TableCell></TableRow>)}
                </TableBody>
              </Table>
              <p className="mt-2 text-muted-foreground">Computed with {r.lines.steel_cost.mechanism} and {r.lines.financing_cost.mechanism}; the later rates are what you typed, not a forecast.</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
