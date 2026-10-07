// lib/subsystem-family.mjs — which "family" of subsystem a BOM tree node belongs to ("F.d.fan Blower with Vfd" and
// "F.D. fan Blower" are both the FD Fan Blower). Pure, no DB. Used by the Subsystems report, the template families and
// the "Add subsystem" picker. Nothing is stored on the node: the family is always computed from its name.
//
// Rules, in order: spelling-insensitive key (dots, spaces and punctuation ignored) -> a short alias table for names the
// client writes several ways -> the boiler body ("Boiler-sf-wb-300-10.54", "Boiler-mf -3000 Kg/hr", "Boiler-500 Kg/hr")
// -> a capacity suffix on any other name ("Boiler Mounting & Fittings -4000 Kg/hr") is dropped. Anything else is its own
// family, labelled as written. Nothing is merged by guesswork: an unknown spelling shows up as a one-project family in
// the report, which is the prompt to add an alias here.
const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const squash = s => String(s ?? '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');

// squashed spelling -> label. Suffixes such as "with vfd" / "with insulation" are removed before the lookup.
const ALIASES = new Map([
  ['fdfanblower', 'FD Fan Blower'], ['fdfan', 'FD Fan Blower'],
  ['idfanblower', 'ID Fan Blower'], ['idfan', 'ID Fan Blower'],
  ['electricalpanel', 'Electrical Panel'], ['electricalpanelforboiler', 'Electrical Panel'],
  ['firedoorandfirebars', 'Fire Door and Fire Bars'], ['firedoorandfirebarsandsupportbars', 'Fire Door and Fire Bars'],
  ['fgduct', 'FG Duct'], ['fgductuptochimney', 'FG Duct'], ['fluegasductuptochimney', 'FG Duct'],
  ['lightingarrestor', 'Lighting Arrestor'], ['lighingarrestor', 'Lighting Arrestor'],
  ['wph', 'WPH'],
]);

const BODY = /^boiler\s*-\s*(?:[a-z]{2,3}\b|\d)/i;           // Boiler-sf-wb-300-10.54, Boiler-mf -3000 Kg/hr, Boiler-500 Kg/hr
const WITH_SUFFIX = /\s+with\s+(?:vfd|insulation)\b.*$/i;
const CAPACITY = /\s*-\s*\d[\d.,]*\s*(?:kg\s*\/\s*hr|tph|kw|hp)\b.*$/i;

export function subsystemFamily(name) {
  const raw = clean(name);
  if (!raw) return { key: '', label: '' };
  if (BODY.test(raw)) return { key: 'boiler-body', label: 'Boiler Body' };
  const base = clean(raw.replace(WITH_SUFFIX, '').replace(CAPACITY, ''));
  const k = squash(base);
  if (ALIASES.has(k)) { const label = ALIASES.get(k); return { key: squash(label), label }; } // key follows the label: every spelling shares one key
  return { key: k, label: base };
}

// A root node with no items of its own and no children carrying items is only a container ("BOILER"), never a family
// worth listing; callers pass the facts they already have.
export const isContainerOnly = ({ parent_id, itemCount }) => parent_id == null && !itemCount;
