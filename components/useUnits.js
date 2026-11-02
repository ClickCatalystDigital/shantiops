'use client';

// The Units setting (lib/units.mjs) for this browser: 'metric' | 'imperial'. Default by market (US build imperial,
// India metric); a choice is kept in the `units` cookie. Stored values are always metric, so this is display-only.
import { useEffect, useState } from 'react';
import { defaultUnits } from '@/lib/units.mjs';

export function readUnits() {
  if (typeof document === 'undefined') return defaultUnits();
  return document.cookie.match(/(?:^|; )units=(metric|imperial)/)?.[1] || defaultUnits();
}

export function useUnits() {
  const [units, setUnits] = useState(defaultUnits);
  useEffect(() => { setUnits(readUnits()); }, []);
  return units;
}

export function saveUnits(units) {
  document.cookie = `units=${units}; path=/; max-age=31536000; samesite=lax`;
  window.location.reload();
}
