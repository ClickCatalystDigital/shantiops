// lib/fixed-assets.js — DB-touching orchestration around lib/depreciation.mjs's pure math, same
// split as lib/ledger-post.js around lib/ledger.mjs.
import { execute, queryAll, queryOne, nextNumber } from './db';
import { postJournalEntry } from './ledger-post';
import { fixedAssetPurchaseLines, depreciationLines, fixedAssetDisposalLines } from './ledger.mjs';
import { monthlyDepreciation } from './depreciation.mjs';

export async function getFixedAssets(company) {
  return queryAll('SELECT * FROM fixed_assets WHERE company = ? ORDER BY purchase_date DESC', [company]);
}

export async function insertFixedAsset({ company, name, category, purchaseDate, cost, salvageValue, usefulLifeYears, method, createdBy }) {
  if (!name || !purchaseDate || cost == null || !usefulLifeYears) {
    throw new Error('name, purchaseDate, cost, usefulLifeYears are required');
  }
  const assetNo = await nextNumber('fixed_asset_no', 'FA');
  const { lastId } = await execute(
    `INSERT INTO fixed_assets (company, asset_no, name, category, purchase_date, cost, salvage_value, useful_life_years, method, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [company, assetNo, name, category ?? null, purchaseDate, cost, salvageValue || 0, usefulLifeYears, method === 'WDV' ? 'WDV' : 'SLM', createdBy ?? null]
  );
  const id = Number(lastId);
  await postJournalEntry({
    company, entryDate: purchaseDate, sourceType: 'fixed_asset', sourceId: id,
    description: `Fixed Asset ${assetNo}: ${name}`, lines: fixedAssetPurchaseLines({ cost }), createdBy,
  });
  return { id, assetNo };
}

// One combined JE per company/period — every active, not-yet-fully-depreciated asset's monthly
// instalment, summed. Idempotent the same way every other posting trigger is: the UNIQUE(company,
// period_year, period_month) on depreciation_runs makes a second call for the same period a no-op.
export async function runDepreciation({ company, periodYear, periodMonth, runDate, createdBy }) {
  const already = await queryOne(
    'SELECT id FROM depreciation_runs WHERE company = ? AND period_year = ? AND period_month = ?',
    [company, periodYear, periodMonth]
  );
  if (already) return { id: already.id, alreadyRan: true };

  const assets = await queryAll("SELECT * FROM fixed_assets WHERE company = ? AND status = 'active'", [company]);
  const lines = assets
    .map(a => ({
      asset: a,
      amount: monthlyDepreciation({
        cost: a.cost, salvageValue: a.salvage_value, usefulLifeYears: a.useful_life_years,
        method: a.method, accumulatedDepreciation: a.accumulated_depreciation,
      }),
    }))
    .filter(l => l.amount > 0);

  const total = lines.reduce((s, l) => s + l.amount, 0);
  const { lastId } = await execute(
    `INSERT INTO depreciation_runs (company, period_year, period_month, run_date, total_amount, created_by) VALUES (?, ?, ?, ?, ?, ?)`,
    [company, periodYear, periodMonth, runDate, total, createdBy ?? null]
  );
  const runId = Number(lastId);
  for (const l of lines) {
    await execute('INSERT INTO depreciation_run_lines (depreciation_run_id, fixed_asset_id, amount) VALUES (?, ?, ?)', [runId, l.asset.id, l.amount]);
    await execute('UPDATE fixed_assets SET accumulated_depreciation = accumulated_depreciation + ? WHERE id = ?', [l.amount, l.asset.id]);
  }
  if (total > 0) {
    await postJournalEntry({
      company, entryDate: runDate, sourceType: 'depreciation_run', sourceId: runId,
      description: `Depreciation ${periodYear}-${String(periodMonth).padStart(2, '0')}`,
      lines: depreciationLines({ amount: total }), createdBy,
    });
  }
  return { id: runId, alreadyRan: false, total, assetCount: lines.length };
}

// Disposal is also this app's correction mechanism for a mis-entered asset (dispose at
// disposalAmount 0) — consistent with the rest of the ledger never editing a posted entry in
// place, only correcting it with a new one.
export async function disposeFixedAsset(id, { disposalDate, disposalAmount, createdBy }) {
  const asset = await queryOne('SELECT * FROM fixed_assets WHERE id = ?', [id]);
  if (!asset) throw new Error('Fixed asset not found');
  if (asset.status === 'disposed') throw new Error('Already disposed');

  await postJournalEntry({
    company: asset.company, entryDate: disposalDate, sourceType: 'fixed_asset_disposal', sourceId: id,
    description: `Disposal of ${asset.asset_no}: ${asset.name}`,
    lines: fixedAssetDisposalLines({ cost: asset.cost, accumulatedDepreciation: asset.accumulated_depreciation, disposalAmount }),
    createdBy,
  });
  await execute(
    "UPDATE fixed_assets SET status = 'disposed', disposed_at = ?, disposal_amount = ? WHERE id = ?",
    [disposalDate, disposalAmount, id]
  );
}
