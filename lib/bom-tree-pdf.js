// lib/bom-tree-pdf.js — PDF export of the read-only Final BOM tree (BomTreeReadOnly.jsx), a
// flattened depth-indented outline — the real-world convention for a printed BOM, and the only
// sane approach given lib/report-pdf.js has no nested-row primitive and literal box/connector
// graphics have real page-break risk at scale. Landscape, same choice lib/bom-pdf.js already made.
import React from 'react';
import { View, Text, StyleSheet } from '@react-pdf/renderer';
import { ReportDocument, ReportTable, renderReportPdf } from './report-pdf.js';
import { hasAmbiguousQty } from './bom-structure.mjs';

const s = StyleSheet.create({
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10, fontSize: 8 },
  footnote: { fontSize: 7, color: '#666', marginTop: 6 },
});

// Depth-first walk producing one row per assembly node and one row per item, interleaved at the
// right depth — same order the screen card renders (roots first, each node's own items right after
// it, then its children). Unassigned items trail at depth 0. An explicit `_key` is required —
// bom_assemblies and bom_items are independent autoincrement sequences that share id values, so
// ReportTable's default `r.id ?? i` rowKey would collide.
export function flattenBomTree(assemblies, unassignedItems) {
  const byParent = new Map();
  for (const a of assemblies) {
    const key = a.parent_id ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(a);
  }
  const rows = [];
  function walk(node, depth) {
    rows.push({ _key: `a-${node.id}`, _kind: 'node', depth, node });
    for (const it of node.items || []) rows.push({ _key: `i-${it.id}`, _kind: 'item', depth: depth + 1, item: it, node });
    for (const child of byParent.get(node.id) || []) walk(child, depth + 1);
  }
  for (const root of byParent.get(null) || []) walk(root, 0);
  for (const it of unassignedItems || []) rows.push({ _key: `u-${it.id}`, _kind: 'item', depth: 0, item: it, node: null });
  return rows;
}

const INDENT_UNIT = '  '; // non-breaking — react-pdf collapses plain whitespace like HTML

function descriptionCell(r) {
  const indent = INDENT_UNIT.repeat(r.depth);
  if (r._kind === 'node') {
    const type = r.node.node_type ? ` (${r.node.node_type})` : '';
    return `${indent}${r.node.name}${type}`;
  }
  return `${indent}BM-${r.item.id} ${r.item.material_description}`;
}

function qtyCell(r) {
  if (r._kind === 'node') return String(r.node.qty ?? 1);
  const ambiguous = hasAmbiguousQty(r.item.qty_text);
  const text = r.item.qty_text || '—';
  return ambiguous ? `${text} *` : text;
}

function rollupCell(r) {
  if (r._kind === 'node') {
    return r.node.rollup_qty !== r.node.qty ? String(r.node.rollup_qty) : '';
  }
  if (r.node && r.node.rollup_qty !== 1 && r.item.rolled_qty != null) return String(r.item.rolled_qty);
  return '';
}

const COLS = [
  ['Description', 42, descriptionCell],
  ['Item Code', 16, (r) => (r._kind === 'item' ? r.item.catalog_item_code || '—' : '—')],
  ['Qty', 18, qtyCell, 'right'],
  ['Roll-up total', 24, rollupCell, 'right'],
];

function BomTreeDoc({ project, rows, hasAmbiguous }) {
  return (
    // Hardcoded like lib/bom-pdf.js's own BomDoc — neither route selects projects.company today.
    <ReportDocument company="Shanti Boilers" title="FINAL BOM — STRUCTURE" orientation="landscape">
      <View style={s.metaRow}>
        <Text>Project: {project.project_no} — {project.customer_name}</Text>
        <Text>{rows.filter((r) => r._kind === 'item').length} item(s)</Text>
      </View>
      <ReportTable cols={COLS} rows={rows} rowKey={(r) => r._key} />
      {hasAmbiguous && (
        <Text style={s.footnote}>
          * This quantity has more than one number in it — only the first is used in the roll-up total.
        </Text>
      )}
    </ReportDocument>
  );
}

export async function renderBomTreePdf({ project, assemblies, unassignedItems }) {
  const rows = flattenBomTree(assemblies, unassignedItems);
  const hasAmbiguous = rows.some((r) => r._kind === 'item' && hasAmbiguousQty(r.item.qty_text));
  return renderReportPdf(<BomTreeDoc project={project} rows={rows} hasAmbiguous={hasAmbiguous} />);
}
