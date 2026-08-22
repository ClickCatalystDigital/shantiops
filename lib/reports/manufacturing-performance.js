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
import {
  getWorkOrderRegisterLines, getReworkRejectionData, getMaterialUtilizationLines,
  getProductionCostVarianceLines, getLabourUtilizationLines, getProductionForecast,
} from '@/lib/data';

export async function computeManufacturingPerformance(company, { from, to } = {}) {
  const [woLines, reworkData, matLines, costLines, labourLines, forecast] = await Promise.all([
    getWorkOrderRegisterLines(company, { from, to }),
    getReworkRejectionData(company, { from, to }),
    getMaterialUtilizationLines({ from, to }),
    getProductionCostVarianceLines(company, { from, to }),
    getLabourUtilizationLines(company, { from, to }),
    getProductionForecast(),
  ]);

  const totalWO = woLines.length;
  const completedWO = woLines.filter((w) => w.status === 'completed').length;
  const inProgressWO = woLines.filter((w) => w.status === 'in_progress').length;
  // Mutually exclusive by `status`, for a composition chart — `delayed` below is a cross-cutting
  // flag (an in_progress WO can also be delayed), not its own status, so it's never one of these
  // slices; double-counting it in a pie would make the slices sum past totalWO.
  const notStartedWO = woLines.filter((w) => ['draft', 'released'].includes(w.status)).length;
  const cancelledWO = woLines.filter((w) => w.status === 'cancelled').length;
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

  const totalLabourHours = Math.round((labourLines.reduce((s, l) => s + (l.total_minutes || 0), 0) / 60) * 10) / 10;
  const totalLabourCost = labourLines.reduce((s, l) => s + (l.labor_cost || 0), 0);

  return {
    totalWO, completedWO, inProgressWO, notStartedWO, cancelledWO, delayedWO,
    totalQtyDone, totalQtyRejected, rejectionRatePct,
    qcFailures: reworkData.totalQcFailures,
    totalSourceWt, totalUsedWt, totalRemnantWt, totalScrapWt, overallYieldPct,
    totalPlannedCost, totalActualCost, totalCostVariance,
    totalLabourHours, totalLabourCost,
    // Next-30-days horizon, same as the standalone Material Shortage report — "how many material
    // lines are currently blocking a Work Order," not a period-scoped historical figure.
    outstandingMaterialLines: forecast.materialDemand.length,
  };
}
