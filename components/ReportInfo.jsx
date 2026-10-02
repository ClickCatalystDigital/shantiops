'use client';

// Plain-language "what do these words mean" popover for the Stores stock reports. Click (not hover)
// so it also works on a phone. Add a report by adding one entry to GLOSSARY.
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { InfoIcon } from 'lucide-react';

const GLOSSARY = {
  'stock-movement': {
    title: 'How to read this statement',
    terms: [
      ['Opening', 'Stock you had on the From date, before that day started. It is everything received minus everything taken out before then.'],
      ['Added', 'Stock that came in during the dates you picked: deliveries, returns, offcuts kept as remnants, and manual corrections up.'],
      ['Removed', 'Stock that went out in the same dates: issued to a project, cut, reserved or owned by a project, and manual corrections down.'],
      ['Closing', 'Stock at the end of the To date. Opening + Added - Removed. If the dates run to today, it must equal what Inventory shows now.'],
      ['Value', 'Closing quantity x the current average cost. It is not the cost on the To date.'],
      ['Issued / Cut', 'Project-wise consumption: "Issued" is material handed to a project; "Cut" is plate or section pieces cut for it (shown in pieces and kg).'],
      ['History starts', 'Movements are recorded from 30 Sep 2026. Earlier dates cannot be shown, so the statement starts there.'],
      ['Red warning', 'Closing does not match current stock for an item. A change was not recorded: tell the developer.'],
    ],
  },
  'stock-valuation': {
    title: 'How to read this',
    terms: [
      ['On hand', 'Free stock in Stores right now, not counting stock already reserved or owned by a project.'],
      ['Avg cost', 'Running average price per unit. Each delivery blends its price with the stock already held.'],
      ['Value', 'On hand x Avg cost.'],
    ],
  },
  'inventory-aging': {
    title: 'How to read this',
    terms: [
      ['Age', 'Days since this item last moved: last bill received or last issue, whichever is later.'],
      ['Current / 1-30 / ... / 90+', 'The age band. 90+ means nothing has moved for over 90 days. "Never" means no movement is recorded.'],
      ['Value', 'On hand x Avg cost, put in its age band.'],
    ],
  },
  'stock-ledger': {
    title: 'How to read this',
    terms: [
      ['Debit (receipt)', 'Quantity received on an approved vendor bill.'],
      ['Credit (issue)', 'Quantity issued to a project.'],
      ['Balance', 'Running total. It counts bill receipts and issues only, so it can differ from Inventory, which also includes cuts, returns and manual corrections. Use the Stock Statement for a figure that matches Inventory.'],
    ],
  },
};

export default function ReportInfo({ report }) {
  const g = GLOSSARY[report];
  if (!g) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={g.title}
          className="ml-1.5 inline-flex size-5 items-center justify-center rounded-full border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          <InfoIcon className="size-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[92vw] text-xs">
        <p className="mb-2 text-sm font-semibold">{g.title}</p>
        <dl className="flex flex-col gap-2">
          {g.terms.map(([t, d]) => (
            <div key={t}><dt className="font-medium text-foreground">{t}</dt><dd className="text-muted-foreground">{d}</dd></div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}
