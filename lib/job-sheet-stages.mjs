// The client's paper Job Card: 33 fixed production stages, same list for every boiler.
// Pure (no DB) so the API, the board and the Operations diagram share one definition.
export const JOB_SHEET_GROUPS = [
  { key: 'rolling', label: 'Rolling & marking' },
  { key: 'fitup', label: 'Fit-up & alignment' },
  { key: 'welding', label: 'Welding & RT' },
  { key: 'boxup', label: 'Box-up & tubes' },
  { key: 'fittings', label: 'Saddles, nozzles & end boxes' },
  { key: 'hydro', label: 'Hydro test' },
  { key: 'finishing', label: 'Finishing' },
  { key: 'dispatch', label: 'Dispatch' },
];

const S = (name, group) => ({ name, group });
export const JOB_SHEET_STAGES = [
  S('SHELL BELT-1 ROLLING', 'rolling'), S('SHELL BELT-2 ROLLING', 'rolling'),
  S('TUBESHEET MARKING', 'rolling'), S('FURNACE-A ROLLING', 'rolling'), S('RC ROLLING', 'rolling'),
  S('FURNACE-B ROLLING', 'rolling'), S('ACCESS RING ROLLING', 'rolling'),
  S('SHELL BELT-1 & 2 ALIGNMENT', 'fitup'), S('FURNACE STIFFENER MARKING', 'fitup'),
  S('FURNACE STIFFENER FITUP', 'fitup'), S('RC TUBESHEET FITUP', 'fitup'),
  S('SHELL BELT-1 & 2 WELDING', 'welding'), S('RADIOGRAPHIC TESTING (RT)', 'welding'),
  S('FURNACE-A & RC ALIGNMENT', 'fitup'), S('SHELL TUBESHEET WELDING', 'welding'),
  S('MARKING ON SHELL', 'boxup'), S('BOXUP', 'boxup'), S('BOXUP WELDING', 'boxup'),
  S('INSIDE WELDING, TUBESHEET, GUSSETS ALL', 'boxup'), S('TUBES INSERTION', 'boxup'),
  S('TUBES WELDING', 'boxup'),
  S('SADDLES FITUP', 'fittings'), S('NOZZLES FITUP', 'fittings'), S('ENDBOXES FITUP', 'fittings'),
  S('NOZZLES WELDING', 'fittings'), S('NOZZLES INSIDE WELDING', 'fittings'),
  S('MUDHOLE FITUP, MANHOLE COVER FITUP', 'fittings'),
  S('HYDRAULIC TEST', 'hydro'),
  S('REFRACTORY', 'finishing'), S('GRINDING, BUFFING', 'finishing'), S('PAINTING', 'finishing'),
  S('FIREBARS SETUP', 'finishing'),
  S('DESPATCH', 'dispatch'),
];

// pending -> in_progress (start date) -> done (end date + production sign) -> qc_signed
export function stageState(r) {
  if (r.qc_sign_by) return 'qc_signed';
  if (r.end_date) return 'done';
  if (r.start_date) return 'in_progress';
  return 'pending';
}

// The stage a job is "at": first stage not yet finished (null when all 33 are done).
export function currentStage(rows) {
  return rows.find(r => !r.end_date) || null;
}

// A finished stage that QC has not signed yet.
export const waitingOnQc = rows => rows.some(r => r.end_date && !r.qc_sign_by);

if (import.meta.url === `file://${process.argv[1]}`) {
  const assert = (await import('node:assert')).default;
  assert.equal(JOB_SHEET_STAGES.length, 33);
  assert.ok(JOB_SHEET_STAGES.every(s => JOB_SHEET_GROUPS.some(g => g.key === s.group)));
  assert.equal(stageState({}), 'pending');
  assert.equal(stageState({ start_date: 'x' }), 'in_progress');
  assert.equal(stageState({ start_date: 'x', end_date: 'y' }), 'done');
  assert.equal(stageState({ end_date: 'y', qc_sign_by: 'q' }), 'qc_signed');
  assert.equal(currentStage([{ end_date: 'a' }, { id: 2 }]).id, 2);
  assert.equal(currentStage([{ end_date: 'a' }]), null);
  assert.equal(waitingOnQc([{ end_date: 'a' }]), true);
  console.log('job-sheet-stages ok');
}
