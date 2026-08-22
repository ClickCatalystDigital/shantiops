// lib/reports/manufacturing-performance.js — Manufacturing Performance Summary: the Management-tier
// (director-altitude) headline for the shop floor, same relationship the Management Report has to
// Trial Balance/P&L — Production's own Reports tab already gives the operational line-item detail
// (Work Order Register, Production Cost Variance, Rework/Rejection, Material Utilization); this is
// the four-number roll-up of that same data, not a fifth detailed ledger. Built entirely from the
// data-layer functions those four reports already call — no new queries.
//
// Deliberately excludes machine/OEE metrics (utilization, downtime) — `workstations` carries only a
// name and machine_hour_rate today, no availability calendar or breakdown log (SYSTEM.md §8's own
// "Machine maintenance / downtime / OEE" gap) — a report shouldn't fabricate a number the data can't
// back.
import { getWorkOrderRegisterLines, getReworkRejectionData, getMaterialUtilizationLines, getProductionCostVarianceLines } from '@/lib/data';

export async function computeManufacturingPerformance(company, { from, to } = {}) {
  const [woLines, reworkData, matLines, costLines] = await Promise.all([
    getWorkOrderRegisterLines(company, { from, to }),
    getReworkRejectionData(company, { from, to }),
    getMaterialUtilizationLines({ from, to }),
    getProductionCostVarianceLines(company, { from, to }),
  ]);

  const totalWO = woLines.length;
  const completedWO = woLines.filter((w) => w.status === 'completed').length;
  const inProgressWO = woLines.filter((w) => w.status === 'in_progress').length;
  const delayedWO = woLines.filter((w) => w.delayed).length;

  const totalQtyDone = woLines.reduce((s, w) => s + w.qty_done, 0);
  const totalQtyRejected = reworkData.totalQtyRejected;
  const rejectionRatePct = (totalQtyDone + totalQtyRejected)
    ? Math.round((totalQtyRejected / (totalQtyDone + totalQtyRejected)) * 100)
    : null;

  const totalSourceWt = matLines.reduce((s, l) => s + l.source_weight, 0);
  const totalUsedWt = matLines.reduce((s, l) => s + l.used_weight, 0);
  const totalRemnantWt = matLines.reduce((s, l) => s + l.remnant_weight, 0);
  const totalScrapWt = matLines.reduce((s, l) => s + l.scrap_weight, 0);
  const overallYieldPct = totalSourceWt ? Math.round(((totalUsedWt + totalRemnantWt) / totalSourceWt) * 100) : null;

  const totalPlannedCost = costLines.reduce((s, l) => s + l.plannedTotal, 0);
  const totalActualCost = costLines.reduce((s, l) => s + l.actualTotal, 0);
  const totalCostVariance = totalActualCost - totalPlannedCost;

  return {
    totalWO, completedWO, inProgressWO, delayedWO,
    totalQtyDone, totalQtyRejected, rejectionRatePct,
    totalSourceWt, totalUsedWt, totalRemnantWt, totalScrapWt, overallYieldPct,
    totalPlannedCost, totalActualCost, totalCostVariance,
    qcFailures: reworkData.totalQcFailures,
  };
}
