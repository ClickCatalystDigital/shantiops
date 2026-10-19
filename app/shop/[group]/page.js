// One shop group (SYSTEM.md §5fh).
import { notFound } from 'next/navigation';
import ShopShell from '@/components/shop/ShopShell';
import ShopGroup from '@/components/shop/ShopGroup';
import { GROUP_BY_KEY, SHOP_SECTIONS, addOnsFor } from '@/lib/shop-catalog.mjs';
import { loadShop } from '../shop-page-data';

export default async function ShopGroupPage(props) {
  const { group: key } = await props.params;
  const sp = await props.searchParams;
  const group = GROUP_BY_KEY.get(key);
  if (!group) notFound();
  const { customer, canEdit, items, groupImages } = await loadShop(`/shop/${key}`);
  const mine = items.filter(i => i.group === key);
  const addOns = {};
  for (const i of mine) {
    const a = addOnsFor(i, items);
    if (a.length) addOns[i.id] = a.map(x => ({ id: x.id, title: x.title, model: x.model, isSet: x.isSet, unit: x.unit,
      groupLabel: GROUP_BY_KEY.get(x.group).label, icon: GROUP_BY_KEY.get(x.group).icon }));
  }
  return (
    <ShopShell isCustomer={customer} canEdit={canEdit}>
      <ShopGroup group={{ ...group, image: groupImages[key] || null }} section={SHOP_SECTIONS.find(s => s.key === group.section)}
        items={mine} addOns={addOns} initialItem={Number(sp?.item) || null} />
    </ShopShell>
  );
}

export async function generateMetadata(props) {
  const { group } = await props.params;
  return { title: GROUP_BY_KEY.get(group)?.label || 'Shop' };
}
