# Old CRM import — data issues (2026-09-25)

Source: the old CRM's Product Master (`31704ece-ProductData.csv`) and Customer summary report (4 parts).

## Products — 1826 rows
- 24 product codes are used by two different products. The first keeps the code; the others were imported as "CODE (2)" (original code kept in `legacy_code`):
  - SBH-AF-100: BOILER-AF-1 TPH
  - BS-SBH-AF-100-3RDPASS: BOILER ERW TUBE - SBH-SF-100-DB-3RDPASS
  - SB-MF-200: BOILER-MULTI-FLAME-200
  - SCT-DF-85-IB-V: BOILER-SCT-DF-85-IB-V
  - SCT-GF-20-MINI: BOILER-SCT-GF-20-MINI
  - SBH-SF-30: BOILER-SF-30
  - SB-SIB-PFB-30: BOILER-SIB-SF-PFB-40
  - SB-FAB-TC-1.5D-750: CHIMNEY TAPPERED -1.5D-750
  - SB-ICD-CF-400: DUCTING INTERCONNECTING-SB-ICD-CF-400
  - FP / 3276: FUSIBLE PLUG, BRONZE, S/P , NON - IBR - 20 MM
  - GV / 3040: GLOBE VALVE, CAST STEEL, F/E , IBR - 250 NB-T/H
  - GV / 3040: GLOBE VALVE, CAST STEEL, F/E , IBR - 300 NB-T/H
  - GV / 3150: GLOBE VALVE, CS , F/E , NON-IBR - 300 NB FOR HOT OIL
  - CI / 7019: GRATE BARS SIMPLEX - 630 G-12
  - 10515: ID FAN - 30 HP
  - 11102: MOTOR 2880 RPM 1 HP
  - MS PIPE - 611: MS PIPE C CLASS - 14`
  - SB-MDC-250: MULTI CYCLONE DUST COLLECTOR-250
  - SB-MF-300: MULTI FLAME-300
  - SB-PRS-600-CS: PRS-600-CS
  - MF/3710: REFLEX GAUGE GLASS - Size A7
  - SB-FAB-SC-750: STRAIGHT CHIMNEY-750
  - STF-SF-100-SU: THERMIC FLUID HEATER-SF-100-SU
  - STF-SF-300-SU: THERMIC FLUID HEATER-SF-300-SU
- 34 products have no code.
- 126 products have price 0 — imported with no price.
- 983 products have GST 0% — imported with GST blank, so quotations use the Default GST % instead of 0%. Confirm which are really exempt.
- Premium / List / AMC price, life span, service frequency, services in warranty and warranty days are 0 for every product — not imported as values.

## Customers — 8971 summary rows -> 8847 organizations
- 124 rows were merged into another row of the same organization (same code, or the same name ignoring Pvt/Ltd/M/s where the codes don't conflict).
- 119 matched existing customers already in Shanti Ops (only blank fields filled). 8728 new customers.
- 604 organizations share an exact name with a different organization (usually people's first names such as "Anil"); they were kept separate and named "Name (code)" / "Name (district)".
- 1315 organizations share a name but were NOT merged because their codes differ, or the name is a single word. Listed in `docs/legacy-crm-possible-duplicates.csv` for review.
- 1 rows could not be read even after rejoining broken lines, and were skipped:
  - export_1.csv: 1690,,Etico Chemicals P Ltd,6,0,FLANGES,MS,T/H,IBR,MS PIPE C CLASS - 4\",2LEAD - COLD 3LEAD - COLD 0LEAD - HOT0LEAD PROJECT - DROPED0PROPOSALS0HOT OFFERS0ORDER 
- 16 rows look like test records and were not imported: TEST - PUJAN; Test 2; test 3; test; test; test; test; Test Demo; Test; TEST; TEST; test 2023; Test; test for checkining; Demo; Demo
- The export is a summary per organization (call counts by stage, totals). It has no enquiry dates, contacts or diary notes, so no enquiries were created from it — it is stored on the customer as "Old CRM summary".
