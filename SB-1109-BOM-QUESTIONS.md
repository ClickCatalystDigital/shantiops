# SB-1109 BOM — open questions for the department head

Working notes from rebuilding SB-1109's BOM off `SB-1109-PMB.xlsx`. Nothing below blocked the
rebuild — every line from the Excel is in the BOM regardless, this is just what still needs a real
answer from someone with domain knowledge. Delete this file once resolved and folded into the data.

## 1. What does "SDC" stand for?

Used throughout the sheet (its own tab, plus "Boiler to SDC" / "SDC to ID Fan" in Flue Gas Duct).
Guessed "Single Dust Collector" but not confirmed — built the System node named literally `SDC` for
now rather than guess wrong. Rename once confirmed.

## 2. Item Master linkage — most Flue Gas Duct / SDC parts don't cleanly match a catalog item

The bulk of Flue Gas Duct + SDC's flanges/reducers/bends (e.g. `FLANGE ID325xOD425x5THK`,
`REDUCER 300NBx250NBx220Lgx3.15T`, `DUCT RECTANGLE 350x250x3.15THK`) look like **thin fabricated
sheet parts** (3.15–5mm), not the same engineering class as Item Master's `FLANGES` group (all
IBR/ASME Class-150/300 pressure-pipe flanges — a real 300NB Class-150 flange is ~32mm thick). Left
these unlinked (free text only) rather than force a wrong match onto a similar-sounding catalog row.

**Question**: are these actually bought pre-made from a fabricator (in which case they're a real gap
— add them to Item Master), or genuinely made in-house from raw plate/pipe stock already in the BOM
(in which case "no link" is correct and nothing needs adding)?

Also unlinked for the same reason: `FLANGE-FLAT ISF50X5THK`, `BEND -45 DEG 350x250x3.15THK`.

## 3. "BOLT & NUTS" as one BOM line has no single matching catalog item

Item Master only has separate `BOLTS <size>` and `MS/GI/SS NUTS <size>` rows — no combined
"bolt+nut" entry. Every "BOLT & NUTS ..." line in the Excel (Flue Gas Duct, SDC, Boiler mounting,
feed line, blow-down line, ID Fan) is in the BOM as free text, unlinked. Fine as-is unless you want
these split into separate Bolt + Nut BOM lines each linked to its own catalog item — more accurate
for procurement, more line items to manage. Your call.

## 4. "Boiler Shell & Body" subsystem name is inferred, not from the source file

BOILER sheet rows 2–18 (BQ Plate, Stay Tubes, Smoke Box, Pin/Bush, MS Flat, refractory anchor rods,
insulation, cladding, etc.) sit under the sheet's own top header ("BOILER-500 KG/HR...") with no
subsystem heading of their own before "BOILER MOUNTING & FITTINGS" starts at row 19. Grouped them
under a Subsystem I've named **"Boiler Shell & Body"** — not literally in the file. Rename if there's
a real name for this grouping.

## 5. ID Fan's own spec block — not put in the BOM, confirm that's right

ID FAN sheet rows 1–7 (Type/Flow/Static Head/Speed/Mounting/Medium/Operating Temp) are the ID Fan
unit's own configuration, not purchasable parts — you confirmed this reading. Not entered as BOM
items (there's nowhere in the schema to hang equipment spec data on a tree node yet). Recorded here
for reference:

> Centrifugal, Inlet 260 dia / Outlet 350x200, 1800 CFM, 6" static head (inch WC), 1440 RPM, belt
> driven, medium: hot flue gas, operating temp 220°C.

## 6. Safety Valve's "Set Pressure I/II" rows (BOILER sl27–30) — folded into Remarks, not separate lines

`SET PRESSURE - I / II: 7 KG/CM2(G)` and `MIN RELIEVING CAP: 500 Kg/hr` (×2, one per valve) have no
MOC/independent qty of their own — they're attributes of the Safety Valve line (sl26, 2 Nos), not
separate parts. Put as a Remarks note on that BOM line instead of 4 phantom zero-qty rows. Flag if
that's wrong.

## 7. Item Master linking — 50 of 181 items now linked (revised, second pass)

First pass only checked 4 obvious matches — too conservative, corrected. Second pass searched
every relevant catalog group (raw pipe/plate/angle/channel/flat, IBR valves/flanges/gauges under
`MOUNTING`, bearings, motor, electrical) and linked 50 items with a real, verified spec match —
material + dimension + class/rating all checked, not just a keyword hit. A few real errors were
caught and fixed during verification (two rows initially linked to the wrong adjacent catalog size
— 40NB vs 50NB, 68" vs 70" — both corrected before finalizing).

**Left unlinked, and why — real gaps or borderline calls, not oversights:**
- **SA105 forged instrument fittings** (Hexnipple/Coupling/Reducer Coupling "FOR Pr.Gauge/Pr.Switch",
  4 lines across Boiler Mounting + Feed Line) — the catalog's `HEX NIPPLE`/`COUPLING` groups are
  lower-pressure MS/threaded fittings (Schedule 40/80, class #1500/#3000), not SA105 forged
  high-pressure instrument fittings. Different product class despite matching thread sizes. Real
  Item Master gap if these are actually stocked.
- **Q' Type Syphone** (3 lines) — zero matches anywhere in the catalog. Real gap.
- **Plummer Blocks** (1 line) — zero matches. Real gap.
- **Bearings, SS, 22209K** — catalog only has self-aligning ball bearings up to `2222-K`;
  `22209K`'s "222-" prefix is a spherical roller bearing, a genuinely different bearing family
  despite the similar-looking number. Not the same part — don't link on this basis.
- **MS Angle at 5mm thickness** (ISA40x40x5, ISA40x5T, 3 lines) — catalog's `MS ANGLE` only carries
  40x40 at 4mm, not 5mm. Close but not the same stock item.
- **Two pressure gauges** (Steam gauge D-6"/1-2"BSP, Feed Line gauge D-4"/3-8"BSP) — the catalog's
  dial-size-to-thread-size pairing doesn't offer either exact combination (6" dials only come
  paired with 3/8" BSP in the catalog, 4" only with 1/4" BSP). Worth confirming whether the Excel's
  thread size is a typo or a real custom spec.
- **MCB 40A/4-pole and 16A/3P** — catalog's MCBs are all listed 3-pole (no 4-pole entry at all),
  and no 16A rating exists (only 10/20/25/32-40/63/80A). Real gaps if these ratings are genuinely
  stocked.
- **I-Bolt with Wing Nuts, SS, 5/8"x4"** — catalog only has `I BOLTS 5/8" X 5"` (wrong length) with
  no material/wing-nut match either. Don't force it.
- **"BOLT & NUTS" as one combined line** — unchanged from the first pass (§3 above) — the catalog
  has separate Bolt/Nut rows, no combined SKU, so these stay unlinked as a single BOM line.
- Everything else not listed here (fabricated flanges/reducers/bends/ducts, named base
  plates/necks/hooks, refractory/insulation consumables, most small electrical hardware — lugs,
  ties, ferrules, wire, tape) is free text because it's a fabricated part or genuinely not carried
  in the catalog at all, consistent with §2's reasoning.
