// The PDFs a presenter drags into the US demo on camera (all fictional, marked SAMPLE):
//   three mill test reports for QC → Test Certificates → Batch upload (one plate report with two heats in ksi,
//   one tube report in psi, one pipe report with three heats), one packing slip (shows "Not an MTR"), and the
//   AB-1001 nameplate facsimile for QC → Data Book.
// Usage: node scripts/demo/make-us-sample-docs.mjs  → scripts/demo/us-sample-docs/*.pdf
import { mkdirSync, writeFileSync } from 'node:fs';
import { samplePdf, mtrDoc } from './sample-pdf.mjs';

const dir = new URL('./us-sample-docs/', import.meta.url);
mkdirSync(dir, { recursive: true });
const docs = {
  'MTR-LSP-55821.pdf': mtrDoc({ certNo: 'LSP-55821', mill: 'Lakeshore Steel Plate Co.', address: '1200 Harbor Road, Gary, IN 46402',
    spec: 'ASME SA-516 Gr.70 / ASTM A516-17 Gr.70, normalized', product: 'Carbon steel plate', date: '10/02/2026', po: 'AB-PO-118-2026', unit: 'ksi',
    heats: [{ heat: 'B4N217', piece: 'P-1', size: '96" x 240" x 1/2"', c: '0.19', mn: '1.05', p: '0.011', s: '0.004', si: '0.24', ys: '48.6', uts: '76.2', el: '27' },
      { heat: 'B4N218', piece: 'P-2', size: '96" x 240" x 5/8"', c: '0.20', mn: '1.08', p: '0.012', s: '0.003', si: '0.22', ys: '47.9', uts: '75.5', el: '26' }] }),
  'MTR-GLT-30944.pdf': mtrDoc({ certNo: 'GLT-30944', mill: 'Great Lakes Tube Mill', address: '88 Mill Street, Toledo, OH 43604',
    spec: 'ASME SA-178 Gr.A, ERW boiler tube', product: '2-1/2" OD x 0.105" WT tube', date: '09/28/2026', po: 'AB-PO-119-2026', unit: 'psi',
    heats: [{ heat: 'T7731', size: '2-1/2" OD x 0.105" WT x 20 ft', c: '0.08', mn: '0.42', p: '0.010', s: '0.008', si: '0.03', ys: '41,200', uts: '55,800', el: '38' }] }),
  'MTR-PRP-7712.pdf': mtrDoc({ certNo: 'PRP-7712', mill: 'Prairie Pipe & Tube', address: '410 Rail Avenue, Peoria, IL 61602',
    spec: 'ASME SA-106 Gr.B / ASTM A53 Gr.B, seamless', product: '2" SCH 40 seamless pipe', date: '10/05/2026', po: 'AB-PO-120-2026', unit: 'ksi',
    heats: [{ heat: 'P20915', size: '2" SCH 40 x 21 ft', c: '0.21', mn: '0.86', p: '0.014', s: '0.006', si: '0.21', ys: '44.1', uts: '68.9', el: '35' },
      { heat: 'P20916', size: '2" SCH 40 x 21 ft', c: '0.22', mn: '0.88', p: '0.013', s: '0.005', si: '0.20', ys: '43.7', uts: '69.4', el: '34' },
      { heat: 'P20922', size: '2" SCH 40 x 21 ft', c: '0.20', mn: '0.84', p: '0.012', s: '0.007', si: '0.23', ys: '45.0', uts: '70.1', el: '36' }] }),
  'Packing-slip-1147.pdf': { org: 'Lakeshore Steel Plate Co.', address: '1200 Harbor Road, Gary, IN 46402', title: 'PACKING SLIP 1147',
    fields: [['Ship to', 'Acme Boilers Inc., Cleveland, OH'], ['Carrier', 'Midwest Freight'], ['PO', 'AB-PO-118-2026']],
    tables: [{ cols: ['Item', 'Description', 'Qty'], widths: [60, 330, 60], rows: [['1', 'Plate 96 x 240 x 1/2 SA-516-70', '1'], ['2', 'Plate 96 x 240 x 5/8 SA-516-70', '1']] }] },
  'Nameplate-AB-1001.pdf': { org: 'Acme Boilers Inc.', address: '4200 Industrial Parkway, Cleveland, OH 44135', title: 'NAMEPLATE FACSIMILE - AB-1001',
    fields: [['Stamp', 'S (power boiler)'], ['Manufacturer serial no.', 'AB-1001'], ['National Board no.', '51002'], ['MAWP', '150 psi'],
      ['Heating surface', '750 sq ft'], ['Max. designed steaming capacity', '5,175 lb/hr'], ['Year built', '2026']],
    notes: ['Rubbing of the stamped nameplate, attached for the record package.'] },
};
for (const [name, doc] of Object.entries(docs)) writeFileSync(new URL(name, dir), await samplePdf(doc));
console.log(`wrote ${Object.keys(docs).length} files to scripts/demo/us-sample-docs/`);
