'use client';

// components/SaleOrderPicker.jsx — pick a Sale Order by typing its number or customer (GET
// /api/sale-orders?search=). Orders already on a project are labelled "on SB-xxxx" (one order may
// cover several variant projects, so they aren't hidden). onChange(id, row), ('', null) when cleared.
import { useRef } from 'react';
import SearchableSelect from '@/components/SearchableSelect';
import { api } from '@/lib/client';
import { formatMoney } from '@/lib/format';

export default function SaleOrderPicker({ value, label = '', onChange, className }) {
  const rows = useRef({});
  const id = value ? String(value) : '';
  const options = [{ value: 'none', label: 'None — create from scratch' }, ...(id && label ? [{ value: id, label }] : [])];
  async function search(q) {
    const found = await api(`/api/sale-orders?search=${encodeURIComponent(q)}`);
    return found.map(so => {
      rows.current[String(so.id)] = so;
      const bits = [so.so_no, so.customer_name, so.total ? formatMoney(so.total) : null, so.item_count ? `${so.item_count} line${so.item_count === 1 ? '' : 's'}` : 'no line items', so.linked_project ? `on ${so.linked_project}` : null];
      return { value: String(so.id), label: bits.filter(Boolean).join(' · ') };
    });
  }
  return (
    <SearchableSelect className={className} value={id || 'none'} options={options} asyncOptions={search}
      displayValue={id ? label : ''}
      onChange={v => (v === 'none' ? onChange('', null) : onChange(v, rows.current[v] || null))}
      placeholder="Search order no. or customer…" />
  );
}
