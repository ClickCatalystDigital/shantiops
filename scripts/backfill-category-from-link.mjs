// Lines already linked to an Item Master row but with no category take the catalog item's bom_category (never overwrites one).
//   node --env-file=.env.local scripts/backfill-category-from-link.mjs [--apply]
import { createClient } from '@libsql/client';
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const apply = process.argv.includes('--apply');
const n = (await db.execute(`SELECT COUNT(*) n FROM bom_items b WHERE b.item_id IS NOT NULL AND (b.category IS NULL OR b.category='') AND (SELECT bom_category FROM items i WHERE i.id=b.item_id) IS NOT NULL`)).rows[0].n;
console.log(apply ? 'filling' : 'would fill', n, 'lines');
if (apply) {
  await db.execute(`UPDATE bom_items SET category=(SELECT bom_category FROM items i WHERE i.id=bom_items.item_id) WHERE item_id IS NOT NULL AND (category IS NULL OR category='') AND (SELECT bom_category FROM items i WHERE i.id=bom_items.item_id) IS NOT NULL`);
  await db.execute({ sql: "INSERT INTO usb_audit (request_id, machine_id, actor, action, detail) VALUES (NULL, NULL, 'script:category-from-link', 'bom_category_backfill', ?)", args: [JSON.stringify({ lines: n })] });
}
