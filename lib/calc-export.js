// lib/calc-export.js — Phase 3.3 (Excel export half of the import/export bridge). `xlsx` is already
// a dependency (see lib/master-import.mjs for the read side); same XLSX.utils.aoa_to_sheet +
// book_append_sheet shape used by the *-selfcheck.mjs fixtures, just for a real download instead of
// a test fixture. Exports the live methodology, not a pinned snapshot — see lib/calc-report-pdf.js
// for the per-snapshot, audit-trail version of this (the PDF report).
import * as XLSX from 'xlsx';
import { computeAll, runValidations, round } from './calc-engine';

export function buildCalcWorkbook({ variables, formulas, validations, tables }) {
  const { values } = computeAll(variables, formulas, { tables });
  const checks = runValidations(validations, values);

  const varSheet = [
    ['Name', 'Type', 'Unit', 'Value'],
    ...variables.map((v) => [v.name, v.type, v.unit || '', v.type === 'computed' ? round(values[v.name]) : v.value]),
  ];
  const formulaSheet = [
    ['Name', 'Output Var', 'Unit', 'Version', 'Status', 'Expression', 'Guard', 'Standard', 'Clause'],
    ...formulas.map((f) => {
      const ver = f.versions.find((v) => v.v === f.curV);
      return [f.name, f.outputVar, f.unit || '', f.curV, f.status, ver.expr, ver.guardExpr || '', f.source?.standard || '', f.source?.clause || ''];
    }),
  ];
  const resultsSheet = [
    ['Variable', 'Value', 'Unit'],
    ...variables.filter((v) => v.type === 'computed').map((v) => [v.name, round(values[v.name]), v.unit || '']),
  ];
  const validationSheet = [
    ['Check', 'Severity', 'Result', 'Message'],
    ...checks.map((c) => [c.name, c.severity, c.pass ? 'PASS' : 'FAIL', c.pass ? '' : c.message]),
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(varSheet), 'Variables');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(formulaSheet), 'Formulas');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resultsSheet), 'Results');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(validationSheet), 'Validations');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
