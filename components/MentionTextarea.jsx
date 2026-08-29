// components/MentionTextarea.jsx
'use client';

// A plain Textarea plus an inline "@" reference trigger — replaces the separate "Insert reference"
// button (deleted EntityRefPicker.jsx): one way to insert a reference, not two. Typing "@" with no
// preceding whitespace back to the cursor opens a small dropdown anchored below the box — first a
// type picker (Material/Job Card/Work Order/Drawing/NCR), then a live-searched result list once a
// type is chosen, filtered by whatever's typed after "@". Selecting a result replaces the whole
// "@query" span with the resolved code + a trailing space.
//
// Deliberately not pixel-positioned at the caret — real caret-coordinate measurement in a plain
// <textarea> is a lot of complexity for near-zero payoff on a 2-row box, where "below the box" and
// "at the caret" land in nearly the same place.
import { useEffect, useRef, useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/client';
// Shared with lib/entity-refs.js's search-route guard — this used to be a second, hand-maintained
// copy that stopped at 8 entries and silently never grew with the registry (found during a gap
// audit: PR/RFQ/PO/QT/SO/PK/FA/CN/DN/SI/VB were all fully taggable but never selectable as a chip
// here). One list now, in the pure token module so this client component doesn't have to import
// lib/entity-refs.js's server-only DB code just for this array.
import { ENTITY_TYPES } from '@/lib/entity-ref-tokens';

// Finds an active "@…" span ending at the cursor — an "@" with no whitespace/newline between it
// and `cursor`. Returns { start, query } or null.
function findMention(value, cursor) {
  const upToCursor = value.slice(0, cursor);
  const at = upToCursor.lastIndexOf('@');
  if (at === -1) return null;
  const between = upToCursor.slice(at + 1);
  if (/\s/.test(between)) return null;
  return { start: at, query: between };
}

export default function MentionTextarea({ value, onChange, placeholder, rows = 2 }) {
  const ref = useRef(null);
  const [mention, setMention] = useState(null); // { start, query, type } | null
  const [results, setResults] = useState([]);
  const [highlight, setHighlight] = useState(0);
  const [busy, setBusy] = useState(false);

  // Live search once a type is chosen — debounced, same 250ms idiom the rest of this feature uses.
  useEffect(() => {
    if (!mention?.type) return;
    setBusy(true);
    const t = setTimeout(() => {
      api(`/api/entity-refs/search?type=${mention.type}&q=${encodeURIComponent(mention.query)}`)
        .then(d => { setResults(d.results || []); setHighlight(0); })
        .catch(() => setResults([]))
        .finally(() => setBusy(false));
    }, 250);
    return () => clearTimeout(t);
  }, [mention?.type, mention?.query]);

  function handleChange(e) {
    const v = e.target.value;
    onChange(v);
    const found = findMention(v, e.target.selectionStart);
    setMention(found ? { ...found, type: mention?.start === found.start ? mention.type : null } : null);
  }

  function insert(code) {
    if (!mention) return;
    const before = value.slice(0, mention.start);
    const after = value.slice(mention.start + 1 + mention.query.length);
    const next = `${before}${code} ${after}`;
    onChange(next);
    setMention(null);
    const pos = before.length + code.length + 1;
    requestAnimationFrame(() => ref.current?.setSelectionRange(pos, pos));
  }

  function handleKeyDown(e) {
    if (!mention) return;
    const list = mention.type ? results : ENTITY_TYPES;
    if (e.key === 'Escape') { setMention(null); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, list.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); return; }
    if (e.key === 'Enter' && list.length > 0) {
      e.preventDefault();
      const picked = list[highlight];
      if (!picked) return;
      if (mention.type) insert(picked.code);
      else { setMention({ ...mention, type: picked.type }); setHighlight(0); }
    }
  }

  const dropdownOpen = !!mention;

  return (
    <div className="relative">
      <Textarea ref={ref} rows={rows} value={value} placeholder={placeholder}
        onChange={handleChange} onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => setMention(null), 150)} />
      {dropdownOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
          {!mention.type ? (
            ENTITY_TYPES.map((t, i) => (
              <button key={t.type} type="button"
                onMouseDown={e => { e.preventDefault(); setMention({ ...mention, type: t.type }); setHighlight(0); }}
                className={`block w-full rounded px-2 py-1.5 text-left text-sm ${i === highlight ? 'bg-muted' : 'hover:bg-muted'}`}>
                {t.label}
              </button>
            ))
          ) : busy ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">Searching…</p>
          ) : results.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">No matches.</p>
          ) : (
            results.map((r, i) => (
              <button key={r.code} type="button"
                onMouseDown={e => { e.preventDefault(); insert(r.code); }}
                className={`flex w-full flex-col rounded px-2 py-1.5 text-left text-sm ${i === highlight ? 'bg-muted' : 'hover:bg-muted'}`}>
                <span className="font-medium">{r.label}</span>
                <span className="text-xs text-muted-foreground">{r.code}{r.project_no ? ` · ${r.project_no}` : ''}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
