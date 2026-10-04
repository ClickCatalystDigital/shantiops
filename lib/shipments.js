// A shipment of fewer than two packing lists is just a list: dissolve it (status 'split', row kept as
// history). Called after a list or a whole project is deleted, so no empty shipment is left behind.
import { execute } from '@/lib/db';

export async function dissolveSmallShipments() {
  await execute(`UPDATE shipments SET status = 'split', split_at = CURRENT_TIMESTAMP
                  WHERE status = 'open' AND (SELECT COUNT(*) FROM packing_lists WHERE shipment_id = shipments.id) < 2`);
  await execute("UPDATE packing_lists SET shipment_id = NULL WHERE shipment_id IN (SELECT id FROM shipments WHERE status = 'split')");
}
