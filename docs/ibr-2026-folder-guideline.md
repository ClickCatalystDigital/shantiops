# IBR 2026 statutory folder — guideline

The reference for anyone (person or AI) changing the QC statutory folder. Read this before editing
`lib/qc-folder-pdf.js`, `lib/qc-ibr.mjs`, `lib/qc-models.js` or the QC document editor. Form mapping and gazette
page numbers: `docs/ibr-2026-forms.md`. Status as of 2026-10-17.

## 0. Rules for changing the folder

1. **The gazette is the only authority for 2026 pages.** Gazette of India Extraordinary No. 596, 1 Oct 2026
   (link below). Copy wording, section numbers, column order and units from its blank forms. Don't add, drop or
   re-word anything the gazette doesn't print; if the app has no value for a line, print the dotted blank.
2. **Never change a 1950 page.** Documents filed before IBR 2026 must reprint word for word. 2026 pages are separate
   components (section "IBR 2026 pages" in `lib/qc-folder-pdf.js`). After any change, render a folder for every
   model in both versions and compare the 1950 text with the previous output; it must be identical.
3. **Version lives on the document** (`qc_documents.ibr_version`, NULL = 1950). Printed names come from
   `formLabel(key, version)`; form sets from `modelConfig(series, version)`. Internal form keys stay the old ones
   (II1, III, IIIA, IVA, IIIH, XVII, plus IVD) — don't rename them.
4. **Units:** strength on 2026 forms is kg/mm² (reg 8(d)(i)); values above 100 are MPa and are converted.
5. **Don't invent facts.** Fixed text such as "Not Applicable" only where this guideline lists it. Anything that
   needs a human decision (stamp location, safety-valve test results) stays a blank to fill by hand.
6. **Check claims against the PDF.** An outside review got several regulations wrong (section 7). Quote the
   regulation text before acting on any suggestion.
7. **Update this guideline** in the same change whenever a form, rule or open point changes.

## Status (2026-10-17)
- **2026 pages:** every form's sections, wording, column order and units follow the gazette blank (checked line by
  line). What is not filled automatically: lines the app has no data for (section 3 below), which print as blanks
  to complete by hand. Not yet signed off by an Inspecting Authority, and no real 2026 folder has been filed.
- **1950 pages:** built against the client's real filed samples (CF/MF/SF/headers) and their stated corrections;
  not re-audited against the 1950 forms index line by line. Unchanged since IBR 2026 work started.

## 1. Sources

| Source | Link |
|---|---|
| Indian Boiler Regulations, 2026 — Gazette of India Extraordinary, Part III Sec. 4, No. 596, 1 Oct 2026 (notification F. No. P-30014/3/2021-Boiler, 7 Aug 2026). In force on publication. | https://egazette.gov.in/WriteReadData/2026/276813.pdf |
| The Boilers Act, 2025 (Act 12 of 2025, in force 1 May 2025) | https://www.indiacode.nic.in/handle/123456789/21395 |
| IBR 1950 forms index (old forms, for comparison) | https://mahaboiler.in/boiler/images/pdf/IBR_CERTIFICATES&FORMS.pdf |

The gazette prints a blank layout of every form. Our 2026 pages were written line by line from those blanks.
Nothing below comes from a client sample or an inspector's sign-off: there is no client available to confirm.

## 2. How the folder is built

- Each QC document has an **IBR version**: `1950` or `2026`. Where it is chosen: the IBR selector next to "All
  projects" on QC → Documents (version for new documents, remembered per browser), the selector on each document
  row (switch an existing document), the New document form and Edit details. Documents made before IBR 2026 are
  1950.
- 1950 pages are unchanged; their printed text is checked identical before/after every change.
- 2026 pages are separate components in `lib/qc-folder-pdf.js` (section "IBR 2026 pages").
- Folder order: covering letter → statutory forms (per model, below) → list of mountings and fittings → the
  test-certificate PDFs themselves. Page numbers ("Page N of M") are stamped on every page.
- A value the app does not store prints as a dotted blank (`……………………`) to be filled by hand, as on the
  printed form. Fixed text such as "Not Applicable" is printed only where stated below.

### Form set per model (IBR 2026)

| Model | Forms |
|---|---|
| CF, MF, OF, SF, GF, DF, AF (shell/fire-tube boilers) | Form I(Part-B) + Form IV(Part-A) + Form IV(Part-B) (one per pipe group) + Form V(Part-B) |
| SIB (small industrial boiler) | Form XXII + Form IV(Part-B) + Form V(Part-B) |
| PRS (pressure reducing station) | Form IV(Part-D) + Form IV(Part-B) (only when a pipe group exists) + Form V(Part-B) |
| HEADERS (standalone steam header) | Form IV(Part-G) + Form V(Part-B) |

Under 1950 these were: boilers II(1)+III+III A+IV A; SIB XVII+III A+IV A; PRS III+IV A; headers III+III-H.

**Reasoning to check:**
- PRS → IV(Part-D): a PRS is an assembly of mountings and fittings; IV(Part-D) is "Certificate of manufacture and
  test of boiler mountings and fittings" (reg 12).
- HEADERS → IV(Part-G) + V(Part-B): IV(Part-G) covers headers (reg 15) and itself says "Refer enclosed raw material
  test certificates or Form-V(Part-B)". Form IV(Part-A) is the boiler's own certificate, so it is not used.
- Boilers file Form I(Part-B) (shop assembled). Form I(Part-C) (site assembled at maker's works) is never offered.

## 3. Data available to the forms

Document fields (typed by QC in Edit details): maker's no., document id, company, boiler type, length overall,
internal diameter, design pressure, working pressure, hydro test pressure + date, year of make, heating surface,
evaporation capacity, steam temperature, submission date, signer, construction facts (seams per belt/ring,
circumferential seams, repairs, heat treatment), parts outside constructor's works, drums details, headers/boxes
details.
Other sources: approved drawing numbers (Design), customer name (project), company name/address (company settings),
parts list and their linked test certificates (cast/heat/plate no., specification, steel maker, steel making
process, heat treatment, C/Mn/P/S/Si, YS, UTS, elongation, bend test), pipe groups (name, design pressure/temp,
process, heat treatment, identification marks, drawing, hydro test), mountings list (description, size, MOC, make,
serial numbers, qty).
**Not stored anywhere:** contract no., certificate no. of the
inspection certificate, stamp location on shell plate, reheater data, safety valve test details, tolerances,
flattening test, "fully killed/rimmed".

## 4. Per form

### Form I (Part-B) — Certificate of inspection for shop assembled boilers (reg 8(a))
Printed in gazette order:
1. Revision line `Form I(B):R01 Dated: 07.08.2026`, title, `[See regulation 8(a)]`.
2. `INSPECTING AUTHORITY:` = recipient name if set, else the company's QC authority designation
   (e.g. "DIRECTORATE OF BOILERS, TELANGANA, HYDERABAD"). `Certificate No.` = dotted blank.
3. Certification paragraph: "the {boiler type} Boiler, built by M/s {company, address} under Maker's number {no.}
   … regulations framed under the Boilers Act, 2025." (" Boiler" not repeated if the type already says boiler.)
4. "The boiler is stamped on the …… Shell Plate" — plate left blank.
5. Stamp block: MAKER'S NAME, MAKER'S NO. / YEAR OF MAKE, TESTED TO {hydro} kg/cm² (g) / ON {date}, Design Pressure
   of boiler. (1950's W.P. line is not printed.)
6. "COMPETENT PERSON'S OR INSPECTING AUTHORITY'S OFFICIAL STAMP".
7. Hydro paragraph: "in the presence of the Competent Person on the 10th day of October 2026".
8. Destructive/NDE sentence; closing paragraph citing Form-IV(Part-A).
9. Signatures: Competent Person / Inspecting Authority, "Date and Seal".
Open: Certificate No. and stamped plate are always blank.

### Form IV (Part-A) — Constructor's certificate of manufacture and test (reg 8(b)), 5–6 pages
- §1 Description: constructor's name and address; manufactured for (customer, else STOCK); Contract No. (blank);
  type; length overall; diameter inside largest belt; design pressure (kg/cm² (g)); **Reheater Pressure = "Not
  Applicable"**; maker number; year; total heating surface (Sq. m); evaporation capacity "(for calculation of
  relieving capacity of safety valves)"; final steam temperature superheater outlet (°C); **Reheater Outlet = "Not
  Applicable"**; brief description (= boiler type).
- §2 Parts at constructor's works: component names (all part names on the document), drawing no., manufactured by
  (company), identification marks (maker's no.); inspected-by and hydro-tested-by lines blank.
- §3 Parts outside: four blank fields + note, "NOT APPLICABLE" unless QC typed something; the gazette Note line.
- §4 Construction: Chapter 3/4/10/12/14/16/17 sentence; "Number of longitudinal seams in shell/drum in each belt"
  (one belt → its value; several → "Belt 1: ONE, Belt 2: TWO"); same for furnace rings; circumferential seams shell
  and furnace; repairs; heat treatment; radiography sentence; "Note : Strike out whichever is not applicable".
  Belt count: regulation 80 allows at most two plates per belt (1 or 2 longitudinal seams per belt). The editor
  pre-fills 2 belts at ≥1000 kg/hr capacity, else 1; QC edits to match the drawing. No regulation fixes the count.
- §5 Details of Drums/Shells: gazette's 13 metric columns; one row "Not Applicable" or QC's typed text; footnote
  "*Indicate (1) Flat (2) Dished (3) Ellipsoidal (4) Hemispherical."
- §6 Headers and Boxes: Description / Size and shape / Thickness in mm / Head or end (Shape, Thickness in mm) /
  Hydrostatic test kg/cm² (g); one row "Not Applicable" or QC's text.
- §7 Mountings: rows Main stop valve, Auxiliary stop valves, Safety valves (a)(b)(c), Blow down valves, Feed check
  valves; Material = MOC, No. = qty, Size = size, matched by name from the mountings list; Type always blank;
  footnote "Certificates of mountings and fittings in Form-IV(Part-D) enclosed (Page N)".
- §8 Safety valves {Regulation 8(d)(vii)}: every gazette line as a blank, plus "SAFETY VALVE TEST CERTIFICATE
  ENCLOSED WITH ANNEXURE."; signature line Maker's representative / Inspecting Authority witnessing tests.
- §9: "parts in sections 2 to 8", drawing nos., "regulations under the Boilers Act, 2025, for a Design pressure of
  …", water test with date; signatures Maker's Representative / Maker, Competent Person / Inspecting Authority;
  "Dated …… the day of …… 20……".
§7 rows: each mounting has a "§7" picker in the editor; unset rows are matched by name (e.g. "steam stop" → main stop valve).
Open: Type column never filled; §8 never filled from the safety-valve certificate.

### Form IV (Part-B) — Certificate of manufacture and test for pipes (reg 10), one per pipe group
- Certificate No. = `{document id}/{group id}`; Date = submission date.
- Name of part & quantity (group name — total qty); drawing; maker's name and address; customer; *MAWP (group design
  pressure); *design temperature.
- RAW MATERIAL: process of manufacture (steel making process from the certificates), fully killed/rimmed (blank),
  chemical composition (per part, "C x Mn y …", joined with ";"), heat number (heat, else cast no.), size, test
  certificate no., steel maker, inspecting authority (blank).
- PIPES: process (group), main dimensions (sizes), tolerances (blank), specification, bend test, flattening test
  (blank), other tests (blank), tensile strength (UTS), chemical composition, heat treatment, hydraulic test (group
  value, else 1.5 × design pressure), identification mark.
- Certification text, both signature blocks, Place/Date, Notes (1)–(6) and the closing paragraph, all as printed.
Open: the gazette form describes one pipe (≤5 for stock); a group with several pipes lists every pipe's values on
each line. The page runs to two pages because of the notes. Hydro = 1.5 × design pressure when not typed: confirm.

### Form V (Part-B) — Results of tests in lieu of original test certificates (reg 8(d)), landscape
- Preamble with maker's no. and drawing numbers, as printed.
- 15 gazette columns: boiler component, quantity, size (T/W/L), cast/heat no. & plate no., steel making process,
  specification, steel maker/part maker, certificate no. & date (number only — no date stored), heat treatment,
  % chemical analysis C Mn P S Si*, yield strength, U.T.S., elongation % gauge length, bend test, name of inspecting
  authority (blank).
- Optional lettered sections (QC-made groups) print as group header rows.
- Footnote "*(Carbon, Manganese, Phosphorus, Sulphur, Silicon)."; certification "This satisfies the requirements of
  Indian Boiler Regulations, 2026."; Maker's Rep/Maker and Competent Person/Inspecting Authority signatures.
- Parts in a pipe group appear on Form IV(Part-B), not here — except for PRS and headers (no pipes form), where every
  part is listed here.
Certificate date and inspecting authority come from the certificate (fields in the certificate form). YS/UTS above 100
are MPa and are converted to kg/mm² (÷ 9.80665).
Open: "other alloying elements" not captured.

### Form IV (Part-G) — Headers, desuperheaters, blowdown/feed tanks, accumulator, deaerator (reg 15)
T.C. NO. = document id; date; part name (boiler type field), maker, customer, drawing; the three-cell block (left:
"Process of manufacture … Flattening Test etc."; middle: "Refer enclosed Raw material Test Certificates or
Form-V(Part-B) …"; right: MAWP, design temp, heat treatment "Refer enclosed Test certificates", hydraulic test,
NDT "Refer enclosed Test certificates"); inspecting authority mark (blank); table Item No. / Part name / Material
size / Quantity / Melt No. (heat, else cast no.); certification, signatures, Final Inspection Date, second
attestation, Place/Date.
Open: the gazette table pre-prints rows PIPE / END COVER / STUBS / BRANCH PIPES; we print the document's own parts
instead. T.C. No. = document id (a real sample once showed a certificate's own number).

### Form IV (Part-D) — Boiler mountings and fittings (reg 12) — used for PRS
Certificate no. (document id), date, name of part (boiler type field, e.g. "Pressure Reducing Station"), quantity
"1", Sl. No. (maker's no.), drawing, maker, customer, MAWP, design temp, hydraulic test pressure, main dimensions
(length overall), specification (from parts), inspecting authority marks (blank). Chemical composition, physical test
results (i)–(iii) and every RAW MATERIAL line: "As per Form-V(Part-B) enclosed". Certification text, both signature
blocks, Place/Date, Notes (1)–(3).
Open: "As per Form-V(Part-B) enclosed" relies on the form's own note that information "obtained from other
certificates" may be referenced — check the Inspecting Authority accepts a reference instead of values. Quantity is
always 1 (one station per document).

### Form XXII — Small industrial boilers (reg 555(2))
12 numbered items as printed: maker + year, manufactured for, location of installation (blank), identification,
drawing, design pressure, size L/W/H/Dia (length overall and internal diameter; W/H blank), material table
Shell/Furnace/Tube plates/Flange/Tube/Pipes/Pads (blank — data is on the enclosed Form V(Part-B)), volumetric
capacity (blank), heating surface, nozzle connections (a)–(e) (blank), shop hydro test + date; certification
"Indian Boiler Regulations, 2026"; signatures.
Item 8 is filled from the parts (first part matching each row's name with a linked certificate); items 4, 5 and 7
follow the gazette layout (Competent Person's stamp, Alteration No., size in metres).
Open: no real SIB project or filled sample exists to compare; W/H of the boiler not stored.

### Covering letter and list of mountings
Covering letter lists every form with its 2026 name and page range. The list of mountings and fittings is our own
index page (description, size, MOC, serial nos., make, qty) placed before the Form IV(Part-D) certificates from the
valve makers; it is not a gazette form.

## 5. Open questions
1. Is any form missing from the boiler set, e.g. Form V(Part-A) (steel maker's certificate) copies or Form IV(Part-C)
   (tubes) / IV(Part-E/F/H) (castings, forgings, dished ends) when such bought-in parts exist?
2. PRS on Form IV(Part-D) + V(Part-B), and headers on Form IV(Part-G) + V(Part-B): correct under the 2026 regulations?
3. Any 2026 field we print as blank that a regulation requires to be filled before submission?
4. Transition: does a boiler started before 1 Oct 2026 file 1950 or 2026 forms? (The app lets QC choose either.)
5. Are "Not Applicable" for reheater pressure/outlet, and "As per Form-V(Part-B) enclosed" on IV(Part-D), acceptable?
6. Telangana registry prefix changed TS → TG (IBR amendment, Feb 2025): affects any printed registry number?

## 6. How to reproduce
In the app: QC → Documents → open a document → Edit details → IBR regulations = 2026 → Preview / Download.

## 7. Outside review, checked against the gazette (2026-10-17)

An outside AI reviewed this brief. Every claim was checked against the official gazette PDF (same file as
egazette.gov.in, byte-identical) and the IBR 1950 forms index; nothing was taken on its word.

| Claim | Gazette says | Result |
|---|---|---|
| Form V(Part-A) is missing | Reg 8(d)(i): V(Part-A) is issued **by the steel maker**; (iii)–(iv): the maker files the extract V(Part-B) along with IV(Part-A). | We don't issue V(Part-A); the steel makers' certificates are the TC PDFs appended to the folder. Under 2026 the covering letter now names them "Steel makers' test certificates (Form-V(Part-A))". |
| Add IV(Part-C/E/F/H) | Regs 11, 13, 14, 16: each is "signed by the maker [of the tube/casting/forging/dished end] and the Inspecting Authority". | These are suppliers' certificates, enclosed like any bought-in certificate (upload as a test certificate PDF). The boiler maker does not generate them. Not built. |
| PRS with fabricated piping also needs IV(Part-B) | Reg 10 (pipes), reg 12 (mountings and steam-pipe fittings). | Agreed. PRS 2026 = IV(Part-D) + IV(Part-B) (printed only when a pipe group exists) + V(Part-B). |
| Form XXII material table must be filled | Reg 555(2) only says XXII is the certificate; the form has the table. | Filled from the parts now (first part matching Shell / Furnace / Tube plates / Flange / Tube / Pipes / Pads with a linked certificate). Also added the gazette's "Competent Person's stamp", "Alteration No.", size table in metres and the tubes/pipes/pads block with diameter and thickness. |
| Reg 308 requires certificate date and inspecting authority on V(Part-B) | Reg 308 is the inspecting authority's **record keeping**; it says nothing about V(Part-B) columns. Reg 8(d)(i) does require "the date of tests", and V(Part-B) has the columns. | Citation wrong, outcome right: certificates now store a date and inspecting authority (entered in the certificate form; date also read by AI extraction), printed on V(Part-B) and IV(Part-B). |
| Form I(Part-C) is for field-erected boilers | Gazette title: "Certificate of inspection for site assembled boilers **at maker's works**"; field erection is Form I(Part-E) "after completion of boiler erection". All forms are issued by the Inspecting Authority. | Claim wrong. Our boilers are shop assembled → Form I(Part-B). |
| Convert MPa to kg/mm² | Reg 8(d)(i): tensile strength "in kilograms per square millimetre". V(Part-B) columns say Kg/mm². | Done on 2026 forms: values above 100 are MPa and are divided by 9.80665 (394 → 40.2). 1950 pages unchanged. |
| §7 mountings by keyword is risky | Reg 8(d)(vii): boilers under 20 t/h carry all mountings certificates with details in IV(Part-A). | Done: each mounting row in the editor has a "§7" picker (main stop / auxiliary stop / safety / blow down / feed check / not listed); unset rows fall back to name matching. |
| Transition: boilers certified on/after 1 Oct 2026 must use 2026 forms | The gazette has only the saving clause ("except as respects things done or omitted to be done before such supersession"); no specific transition rule. | Not proven by the gazette. QC keeps choosing per document. |
| Enforce "TG" prefix | Reg 301: the **registry number** engraved after registration uses state letters; Telangana = TG. | Correct fact, but the registry number is issued by the Chief Inspector after registration and does not appear in the maker's folder. Nothing to change. |
| Form XI must be filed | Form XI is the Memorandum of Inspection Book kept by the Inspector (regs 300, 306). | Not a maker's form. Nothing to change. |
