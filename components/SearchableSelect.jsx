'use client';

// A type-to-filter dropdown for a local list of options — Category and Size pickers (PrWorkspace's
// CategoryFieldsBlock/LineCard, StoresWorkspace's ItemFormDialog/SpecField) went from a handful of
// items to lists as long as 25 (ISA angle sizes) or 23 (flat bar combos); a plain Select forces
// scrolling through all of them with no way to type "50" and jump straight to it. Same
// type-then-pick-from-a-list-below interaction this codebase already uses for the item catalog
// (ItemSearchField in this file, StoresWorkspace/SalesWorkspace's own copies) — reused here for a
// local `options` array instead of a server search, not a second interaction pattern to learn.
import { useState } from 'react';
import { Input } from './ui/input';
import { cn } from '@/lib/utils';

// `displayValue` + `onTextChange` (both optional, both opt-in) turn this into a hybrid field for a
// title that's sometimes a real BOM link and sometimes free-typed text with no matching option at
// all (QcDocumentEditor's Mountings row description) — plain `value`/`selected?.label` can only ever
// show an OPTION's label, so an unlinked row's real text would otherwise have nowhere to display
// except the placeholder slot (which reads as "empty" even though there's real data there).
// `displayValue` is the current real text regardless of whether it matches an option; `onTextChange`
// fires on every keystroke so the caller can save free typing as-is, separately from `onChange`
// (which still only fires when an option is actually picked). Neither prop touches any existing
// caller: `currentText` reduces to exactly `selected?.label ?? ''` when `displayValue` is omitted,
// and the blank-on-focus behavior only changes when `onTextChange` is provided.
// `className` sizes/positions the wrapper (width, margins) — it lands on the outer `relative` div,
// which is where every existing caller's `w-*` sizing already needed to apply. Text/border/background
// styling on the *input itself* (font size, ghost-until-focused borders, etc.) needs a real second
// hook, since those Tailwind classes on the wrapper never reached the actual `<input>` — `text-sm` on
// a parent div doesn't override the child Input's own explicit `text-base md:text-sm` classes, and a
// border/bg utility on the wrapper never touched the input's own border/bg at all. `inputClassName`
// is that hook, applied straight onto the `<Input>` via the same `cn()` merge (later classes win), so
// existing callers relying on the input's default look are unaffected by adding this optional prop.
// `asyncOptions(query) => Promise<{value,label}[]>` (optional) — a live server search, merged in
// alongside the local `options` list once 2+ chars are typed. Same threshold/best-effort-catch
// precedent as BomLineFields.jsx's ItemSearchField (the established Item Master typeahead), reused
// here instead of duplicating a second fetch-and-render component for node-name search.
export default function SearchableSelect({ value, onChange, options, placeholder = 'Search…', className, inputClassName, displayValue, onTextChange, onKeyDown, autoFocus, asyncOptions }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [remote, setRemote] = useState([]);
  const selected = options.find(o => o.value === value);
  const currentText = displayValue ?? selected?.label ?? '';
  const localFiltered = query.trim()
    ? options.filter(o => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;
  const localValues = new Set(localFiltered.map(o => o.value.toLowerCase()));
  const filtered = asyncOptions ? [...localFiltered, ...remote.filter(o => !localValues.has(o.value.toLowerCase()))] : localFiltered;

  async function search(text) {
    if (!asyncOptions) return;
    if (text.trim().length < 2) { setRemote([]); return; }
    try { setRemote(await asyncOptions(text.trim())); } catch { /* best-effort */ }
  }

  function pick(opt) {
    onChange(opt.value);
    setQuery('');
    setRemote([]);
    setOpen(false);
  }

  return (
    <div className={cn('relative', className)}>
      <Input
        autoFocus={autoFocus}
        className={inputClassName}
        value={open ? query : currentText}
        onChange={e => { setQuery(e.target.value); setOpen(true); onTextChange?.(e.target.value); search(e.target.value); }}
        onFocus={() => { setQuery(onTextChange ? currentText : ''); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
        placeholder={currentText || placeholder}
      />
      {open && (
        <div className="absolute top-full z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover shadow-md">
          {filtered.length === 0 ? (
            <div className="px-2.5 py-1.5 text-sm text-muted-foreground">No match</div>
          ) : filtered.map(o => (
            <button key={o.value} type="button" onMouseDown={() => pick(o)}
              className={cn(
                'flex w-full items-center px-2.5 py-1.5 text-left text-sm hover:bg-muted/40',
                o.value === value && 'bg-muted/60 font-medium'
              )}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
