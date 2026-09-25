# Techno Fab Order & Payments Tracker import — notes for the client (2026-09-25)

Source: `4_STF_Order- Payments Tracker (TECHNO FAB) 24-26.xlsx` (sheets ORDER + PAYMENT).
Script: `scripts/import-sales-tracker.mjs <file> --company="Shanti Techno Fab" --tag=import:sales-tracker-stf-2026-09-25 [--apply]`.
Undo: `node scripts/import-sales-tracker.mjs --rollback --tag=import:sales-tracker-stf-2026-09-25`
(refuses if an imported order has since been given a project, items or a hand-entered payment).
Rollback was run once against the live database and left it identical before the final import.

## What went in

| | Rows | Amount |
|---|---|---|
| Orders | 85 | ₹26,90,25,647 (matches the sheet's own "Total Value") |
| Payments | 257 | ₹21,10,81,830.91 |

All rows are `company = 'Shanti Techno Fab'`, so the company selector shows them separately from
the 1,006 Shanti Boilers orders. As before, the PAYMENT sheet is the source of truth for money; the
ORDER sheet's Received/Pending columns are formulas and were only used to spot the mismatches below.

## Please check (Excel as-is)

- **Duplicate Order ID `STF-IBR-066`** (SHRI GANESH RICE MILLS, two rows). The second is stored as
  `STF-IBR-066 (2)`; all payments were recorded against the first. The sheet shows ₹12,00,000
  received on the second row but no PAYMENT row points at it.
- **`STF NIBR-002`** (TOUHID ENTERPRISES): payments total ₹39,67,265 but the ORDER row shows no
  order value and ₹0 received.
- **2 payments with no Order ID** (₹4,04,630) and **2 payment rows with no amount** — not imported.
- **Orders with no date**: `STF-IBR-034/35 C`, `STF-IBR-046`, `STF-IBR-067` (2 more got the date of
  their first payment). 6 payments have no received date.
- **Customers**: 24 of 85 orders matched an existing customer by exact name; 61 orders (55 names)
  kept the name as text only. Link them from the order when the customer is confirmed.
- **Sales person** blank on 4 orders → "Unassigned"; `AMITB`/`AMIT B` → "Amit B".
