// scripts/bom-demand-origin-selfcheck.mjs — runnable check for demandOrigin() (lib/bom-fields.mjs,
// Stores/Inventory hardening Phase 1). Unlike stock-pieces.js/remnant-match.js (plain .js, only
// loadable through Next's bundler), lib/bom-fields.mjs is already .mjs and dependency-free (no DB,
// no next/headers) — imported directly here, no hand-mirroring needed.
//   node scripts/bom-demand-origin-selfcheck.mjs
import assert from 'node:assert';
import { demandOrigin } from '../lib/bom-fields.mjs';

// A PR-raised row (any bom_items.source — bom/stock/sas all set pr_item_id the same way).
assert.strictEqual(demandOrigin({ pr_item_id: 42, template_id: null, import_id: null }), 'pr');

// A flat bom_templates apply — no pr_item_id.
assert.strictEqual(demandOrigin({ pr_item_id: null, template_id: 7, import_id: null }), 'template');

// A PMB Excel import — no pr_item_id, no template_id.
assert.strictEqual(demandOrigin({ pr_item_id: null, template_id: null, import_id: 99 }), 'pmb');

// Hand-typed / pasted / a structure-template-applied node (no bom_items-level template link exists
// for that path — accepted limitation, see the plan doc) — none of the three set.
assert.strictEqual(demandOrigin({ pr_item_id: null, template_id: null, import_id: null }), 'manual');
assert.strictEqual(demandOrigin({}), 'manual');

// Deterministic priority when more than one is somehow set (shouldn't happen in practice, given
// every real insertion site sets at most one — but the function must never throw or return
// something ambiguous): pr_item_id wins over template_id, which wins over import_id.
assert.strictEqual(demandOrigin({ pr_item_id: 1, template_id: 2, import_id: 3 }), 'pr');
assert.strictEqual(demandOrigin({ pr_item_id: null, template_id: 2, import_id: 3 }), 'template');

console.log('bom-demand-origin-selfcheck: all assertions passed');
