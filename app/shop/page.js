// Shop landing (SYSTEM.md §5fh). Separate from the order-progress portal; reachable from its header.
import ShopShell from '@/components/shop/ShopShell';
import ShopHome from '@/components/shop/ShopHome';
import { SHOP_SECTIONS, SHOP_GROUPS, GROUP_BY_KEY, groupSummary } from '@/lib/shop-catalog.mjs';
import { loadShop } from './shop-page-data';

export const metadata = { title: 'Shop' };

export default async function ShopPage(props) {
  const sp = await props.searchParams;
  const { customer, canEdit, items, groupImages } = await loadShop('/shop');
  const byGroup = new Map();
  for (const i of items) byGroup.set(i.group, [...(byGroup.get(i.group) || []), i]);
  const sections = SHOP_SECTIONS.map(s => ({
    ...s,
    groups: SHOP_GROUPS.filter(g => g.section === s.key && byGroup.has(g.key)).map(g => {
      const its = byGroup.get(g.key);
      const main = g.kind === 'equipment' ? its.filter(i => i.isSet) : its;
      const sum = groupSummary(main.length ? main : its);
      return { key: g.key, label: g.label, blurb: g.blurb, icon: g.icon, kind: g.kind, image: groupImages[g.key] || null, count: its.length, range: sum.range, fuels: sum.fuels };
    }),
  })).filter(s => s.groups.length);
  // search index: one lower-case string per item; finder pool: equipment that has an output
  const index = items.map(i => ({ id: i.id, g: i.group, t: i.title, m: i.model, gl: GROUP_BY_KEY.get(i.group).label,
    s: `${i.title} ${i.name} ${i.model || ''} ${GROUP_BY_KEY.get(i.group).label} ${i.fuels.join(' ')}`.toLowerCase() }));
  const finderPool = items.filter(i => i.isSet && i.capacity && (i.section === 'steam' || i.section === 'thermal')).map(i => ({
    id: i.id, g: i.group, t: i.title, m: i.model, series: i.series,
    use: i.section === 'steam' ? 'Steam' : 'Thermal fluid / hot water',
    fuels: i.fuels.length ? i.fuels : ['Other'],
    cap: { v: i.capacity.kg ?? i.capacity.value, l: i.capacity.label },
    pres: i.pressure && i.section === 'steam' ? { v: i.pressure.value, l: i.pressure.label } : null,
  }));
  return (
    <ShopShell isCustomer={customer} canEdit={canEdit}>
      <ShopHome initialSection={sp?.section || null} sections={sections} index={index} finderPool={finderPool} />
    </ShopShell>
  );
}
