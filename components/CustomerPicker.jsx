'use client';

// components/CustomerPicker.jsx — pick a customer by typing (searches GET /api/customers?search=,
// name / code / GST / phone). Used instead of passing the whole customer list (9k+ rows since the
// old-CRM import) into every page. `value` is the id (string or number), `name` its display text;
// onChange(id, name). `allowFreeText` keeps typed text that matches nobody (onTextChange).
import { useRef } from 'react';
import SearchableSelect from '@/components/SearchableSelect';
import { api } from '@/lib/client';

export default function CustomerPicker({ value, name = '', onChange, onTextChange, placeholder = 'Search customer…', className, extraOptions = [] }) {
  const names = useRef({});
  const id = value ? String(value) : '';
  const options = [...extraOptions, ...(id && name ? [{ value: id, label: name }] : [])];
  async function search(q) {
    const rows = await api(`/api/customers?search=${encodeURIComponent(q)}`);
    return rows.map(c => { names.current[String(c.id)] = c.name; return { value: String(c.id), label: c.party_code ? `${c.name} · ${c.party_code}` : c.name }; });
  }
  return (
    <SearchableSelect className={className} value={id} options={options} asyncOptions={search}
      displayValue={onTextChange ? name : (id ? name : undefined)}
      onTextChange={onTextChange}
      onChange={v => { const opt = extraOptions.find(o => o.value === v); onChange(v, opt ? opt.label : names.current[v] || name); }}
      placeholder={placeholder} />
  );
}
