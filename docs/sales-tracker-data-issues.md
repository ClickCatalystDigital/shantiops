# Sales Payment Tracker — data issues to fix / questions for the client

Import of "SB Order - Payments Tracker - SHANTI BOILERS 21-26.xlsx" done 2026-09-19: **1,006 orders**, **1,905 payments** (₹81.71 Cr). Everything below is what is *wrong or unclear in the Excel*. "Row" = the Excel row number in that sheet, so the client can jump straight to it. Nothing here blocks the app; each item says what the app did meanwhile.

Sheets: **ORDER** = the orders list, **PAYMENT** = the payments list.

---

## A. Please fix in the Excel

### A1. Payments with no matching order — NOT imported (2 rows, ₹17,11,250.77)
The Order ID in PAYMENT does not exist in the ORDER sheet. Either add the order or correct the ID.

| PAYMENT row | Order ID | Date | Amount | Remark |
|---|---|---|---|---|
| 884 | SB-1008 | 2023-10-06 | ₹16,10,950.77 | ADVANCE |
| 1265 | SB-1054 A/B | 2024-09-25 | ₹1,00,300 | ON ACCT |

### A2. Payments with no Order ID — NOT imported (16 rows, ₹3,63,254.6)

| PAYMENT row | Date | Amount | Invoice | Remark |
|---|---|---|---|---|
| 424 | 2022-09-12 | ₹0 | — | — |
| 435 | — | ₹0 | — | — |
| 448 | 2022-10-07 | ₹0 | — | BALANCE RECEIVED |
| 453 | 2022-10-10 | ₹0 | — | BALANCE RECEIVED |
| 459 | 2022-10-15 | ₹0 | — | BALANCE RECEIVED |
| 1614 | 2025-11-12 | ₹0 | — | — |
| 1622 | — | ₹2,109.6 | — | tds |
| 1701 | 2026-03-14 | ₹14,160 | — | — |
| 1725 | 2026-04-24 | ₹23,948 | — | — |
| 1743 | 2026-05-20 | ₹1,93,520 | — | — |
| 1752 | 2026-06-02 | ₹23,948 | — | — |
| 1779 | 2026-06-26 | ₹15,045 | — | — |
| 1790 | 2026-07-07 | ₹4,372 | — | — |
| 1817 | 2026-08-05 | ₹31,152 | — | — |
| 1823 | 2026-08-11 | ₹5,000 | — | — |
| 1954 | 2026-09-08 | ₹50,000 | — | — |

### A3. Payment rows with no amount — NOT imported (29 rows)

| PAYMENT row | Order ID | Date | Mode | Remark |
|---|---|---|---|---|
| 12 | SAS-59 | — | — | — |
| 96 | SB-893 | 2021-12-22 | NEFT/IMPS | ADVANCE |
| 168 | SB-899 | 2022-02-18 | NEFT/IMPS | BALANCE RECEIVED |
| 360 | SB-943 | 2022-07-30 | NEFT/IMPS | ADVANCE |
| 371 | SAS-150 | — | Other | FOREX INCOME |
| 381 | SB-1066 | 2022-08-16 | NEFT/IMPS | BALANCE RECEIVED |
| 413 | NIBR-215 | 2022-08-31 | NEFT/IMPS | ADVANCE |
| 420 | SAS-185 | 2022-09-12 | Other | ORDER CANCELLED |
| 439 | NIBR-214 | 2022-08-31 | NEFT/IMPS | ADVANCE |
| 451 | SAS-57 | 2022-10-08 | NEFT/IMPS | BALANCE RECEIVED |
| 452 | SAS-57 | 2022-10-09 | NEFT/IMPS | BALANCE RECEIVED |
| 458 | SAS-57 | 2022-10-13 | NEFT/IMPS | BALANCE RECEIVED |
| 604 | SB-975 | 2023-03-03 | Cash | ADVANCE |
| 605 | SB-975 | 2023-03-10 | Cash | ADVANCE |
| 704 | SAS-196 | 2023-05-29 | Credit note | ADJUST AGAINST DUE |
| 708 | SB-954 | 2023-05-25 | NEFT/IMPS | ADAVANCE |
| 790 | SB-975 | 2023-07-27 | NEFT/IMPS | BALANCE RECEIVED |
| 895 | SB-979 | 2023-10-21 | NEFT | — |
| 921 | SAS-57 | 2023-11-10 | NEFT/IMPS | BALANCE RECEIVED |
| 982 | SB-951 | — | NEFT/IMPS | — |
| 1144 | SB-895 | 2024-03-12 | NEFT/IMPS | BALANCE RECEIVED |
| 1145 | SB-1009 | 2024-03-12 | NEFT/IMPS | BALANCE RECEIVED |
| 1225 | SB-1034 | 2024-08-13 | NEFT/IMPS | BALANCE RECEIVED |
| 1226 | SB-1034 | 2024-08-14 | NEFT/IMPS | BALANCE RECEIVED |
| 1234 | SB-1056 ADJ - 2 | 2024-08-27 | NEFT/IMPS | BALANCE RECEIVED |
| 1235 | SB-1049 EXP | 2024-09-05 | NEFT/IMPS | BALANCE RECEIVED |
| 1239 | SB-1060 | — | NEFT/IMPS | RECD IN TECHNO |
| 1308 | SAS-398 | — | — | — |
| 1334 | SB-1075-U | 2024-12-30 | Cash | DBT A/C |

### A4. Payments with no date — imported with a blank date (50 rows)
The money is counted, but "Payment Received On" is empty. Please supply the dates.

| PAYMENT row | Order ID | Amount | Remark |
|---|---|---|---|
| 6 | NIBR-181 | ₹76,700 | — |
| 13 | SAS-60 | ₹1,00,000 | ADVANCE |
| 16 | SAS-62 | ₹24,101.5 | 100% Advance |
| 17 | SAS-65 | ₹45,371 | 100% Advance |
| 21 | SR-1 | ₹2,00,000 | ADVANCE |
| 23 | SB-890 | ₹10,00,000 | ADVANCE |
| 31 | LC-03 | ₹15,000 | ADVANCE |
| 34 | SAS-67 | ₹0.5 | ROUND OFF |
| 44 | SB-896 | ₹11,32,200 | ADVANCE |
| 64 | SB-899 | ₹1,00,000 | ADVANCE |
| 85 | SAS-59 | ₹2,950 | BALACE RECEIVED |
| 148 | SB-854 | ₹11,27,300 | — |
| 151 | SAS-104 | ₹21,240 | ADJUSTED IN PRAJ |
| 178 | SB-862 | ₹10,00,000 | cash received |
| 185 | SAS-63 | ₹44,840 | JV ADJSUTED |
| 187 | SAS-73 | ₹2,06,500 | JV ADJSUTED |
| 207 | SAS-61 | ₹68,690.75 | AGANIST DEBIT NOTE |
| 208 | NIBR-187 | ₹50,000 | BALANCE RECEIVED |
| 270 | SB-910 | ₹2,25,400 | — |
| 282 | LC-23 | ₹41,300 | ADJUSTMENT AGNST PURCHASE |
| 283 | LC-22 | ₹41,300 | ADJUSTMENT AGNST PURCHASE |
| 284 | LC-24 | ₹41,300 | ADJUSTMENT AGNST PURCHASE |
| 330 | SB-935 | ₹17,74,500 | ADVANCE |
| 370 | SAS-117 | ₹7,906 | CASH RECED |
| 376 | LC-04 | ₹1,700 | TDS RECEIVABLE |
| 397 | SAS-151 | ₹3,54,000 | RECED BY SRIVAARI |
| 464 | SAS-134 | ₹6,726 | Cash Sale |
| 530 | SB-910 | ₹55,107 | — |
| 565 | SAS-178 | ₹1,64,972 | — |
| 794 | SAS-260 | ₹1,50,000 | DEBIT NOTE |
| 834 | SB-969 -2 | ₹7,00,000 | CASH REC |
| 1006 | SB-937 | ₹24,90,000 | advance |
| 1007 | SB-937 | ₹8,55,300 | — |
| 1008 | NIBR - 211 | ₹2,96,970 | — |
| 1016 | SB-1010 | ₹20,00,000 | ADVAnce |
| 1116 | SB-1047 | ₹2,00,000 | ADVANCE |
| 1161 | SB-1043 | ₹2,97,960 | — |
| 1199 | SAS-381 | ₹50,000 | CASH |
| 1200 | SAS-383 | ₹38,168 | — |
| 1243 | SB-1053 | ₹47,000 | CASH |
| 1309 | SB-1074 | ₹4,80,000 | ADVANCE |
| 1339 | SB-1077 | ₹2,00,000 | — |
| 1349 | SB-1026 | ₹2,25,000 | personally to amit sir |
| 1350 | SB-1026 | ₹15,00,000 | cash in hyderabd |
| 1357 | NIBR - 284 | ₹8,200 | ADVANCE |
| 1358 | SB-1078 | ₹1,50,000 | ADVANCE |
| 1367 | SB-961 | ₹77,150 | — |
| 1368 | SB-1031 | ₹1,22,850 | — |
| 1401 | SAS-412 | ₹85,000 | — |
| 1447 | SAS-393 | ₹1,10,511 | — |

### A5. Dates that look like typos — imported exactly as written

**Orders dated in the future:**

| ORDER row | Order ID | Customer | Date in sheet |
|---|---|---|---|
| 896 | SAS-478 | COROBUS ALCOBEV | 2026-11-03 |
| 901 | NIBR-322 | PATIL INFRASTRUCTURE | 2026-10-04 |
| 905 | LC-79 | RE SUSTAINABILITY-MUMBAI WASTE MANAGEMENT LIMITED | 2026-10-04 |

**Payments dated in the future (year 2055):**

| PAYMENT row | Order ID | Amount | Date in sheet |
|---|---|---|---|
| 1559 | SB-1088 | ₹5,00,000 | 2055-08-25 |
| 1560 | SB-1076 | ₹1,50,000 | 2055-08-25 |
| 1561 | NIBR - 284 | ₹7,383 | 2055-08-26 |
| 1562 | SB-1087 | ₹1,00,000 | 2055-08-28 |

### A6. Orders with no Order Date (38)
The app used the earliest payment date where one exists; "none" means there is no date anywhere.

| ORDER row | Order ID | Customer | Value | App used |
|---|---|---|---|---|
| 219 | SAS-151 | SRIVAARI AGENCIES | ₹3,54,000 | none |
| 251 | SAS-156R1 | SWARNNA TECHNO | ₹19,423 | 2022-07-25 (earliest payment) |
| 320 | SB-954 | FRONTIER PLYWOOD | ₹30,68,000 | 2020-10-08 (earliest payment) |
| 526 | NIBR-261 | PARKER HYDRAULICS HYDERABAD | ₹10,20,700 | 2023-11-06 (earliest payment) |
| 534 | SAS-297 | PATIL RAIL INFRASTRUCTURE | ₹44,132 | 2023-11-16 (earliest payment) |
| 559 | NIBR-264 | CROWN BEERS INDIA PRIVATE LTD | ₹1,45,00,000 | 2024-02-08 (earliest payment) |
| 655 | NIBR-276 | BIOMATIQ PVT LTD | ₹8,49,600 | 2024-07-26 (earliest payment) |
| 686 | SAS-383 | SARVODHAYA TECHNOLOGIES | ₹1,73,720 | none |
| 687 | SAS-384 | SHOBHA LIFE SCIENCES | ₹7,080 | 2024-07-25 (earliest payment) |
| 699 | SB-1060 | FLAKERY PLASTICS | ₹9,20,400 | 2024-08-19 (earliest payment) |
| 700 | SB-1061 | SIDHI VINAYAKA PLASTIC | ₹9,14,500 | 2024-08-13 (earliest payment) |
| 701 | SAS-388 | NSL TEXTILES | ₹69,83,240 | 2024-10-04 (earliest payment) |
| 702 | LC-63 | NSL TEXTILES | ₹39,31,760 | 2024-10-04 (earliest payment) |
| 703 | SAS-389 | BOTANIC HEALTHCARE | ₹3,396 | 2024-10-13 (earliest payment) |
| 704 | SAS-390 | LINK NATURAL | ₹0 | none |
| 707 | SAS-392 | ADITYA MEDIPHARMA | ₹53,100 | 2024-10-22 (earliest payment) |
| 725 | LC-66 | NSL SUGARS | ₹1,18,000 | 2024-12-02 (earliest payment) |
| 728 | SAS-397 | NAGARJUNA CERACHEM | ₹16,638 | 2024-12-13 (earliest payment) |
| 752 | SAS-406 | AS FURNITURE | ₹4,130 | 2025-02-25 (earliest payment) |
| 769 | SAS-412 | COMPASS BIO | ₹1,86,558 | 2025-04-03 (earliest payment) |
| 784 | NIBR-295 | SIDHI VINAYAKA PLASTIC | ₹7,52,250 | 2025-04-29 (earliest payment) |
| 794 | SAS-424 | NSL TEXTILES FRIGHT REFACTORY | ₹1,53,400 | 2025-05-03 (earliest payment) |
| 795 | SAS-425 | NSL TEXTILES FRIGHT REAR WATER WALL | ₹20,060 | 2025-05-03 (earliest payment) |
| 808 | LC-71 | NSL TEXTILES LTD | ₹10,27,256.39 | 2025-06-13 (earliest payment) |
| 809 | LC-72 | FRESH BOWL HORTICULTURE PRIVATE LIMITED | ₹5,900 | 2025-06-11 (earliest payment) |
| 844 | SAS-448 | HYDERABAD PLY WOOD | ₹3,37,225.36 | none |
| 856 | SB-1092 | M AND TECH ENGINEERING | ₹10,33,680 | 2025-10-21 (earliest payment) |
| 859 | NIBR 313 C | SS POULTRY | ₹2,00,000 | 2025-11-26 (earliest payment) |
| 860 | SAS-457 | GLOSTER | ₹88,146 | 2025-11-11 (earliest payment) |
| 861 | SAS-458 | CHANDRA LIFE SCIENCES PVT LIMITED | ₹98,695 | 2025-11-19 (earliest payment) |
| 862 | SAS-459 | LAKSHMI AAC BLOCKS | ₹17,358 | 2025-11-21 (earliest payment) |
| 864 | SAS-461 | CHANDRAVATHI RICE & FLOUR MILL | ₹55,890 | 2025-12-06 (earliest payment) |
| 865 | SAS-462 | PEARL BEVERAGES LIMITED | ₹42,480 | 2025-12-09 (earliest payment) |
| 893 | NIBR-320 | SPC INFRA PROJECTS | ₹10,69,670 | 2026-02-25 (earliest payment) |
| 909 | 1097 | STOCK SF-100 | ₹0 | none |
| 911 | NIBR-324 | HOTEL AMBASSADOR | ₹2,48,390 | 2026-04-21 (earliest payment) |
| 1017 | NIBR-335 | MALKHA MARKETING | ₹3,18,600 | none |
| 1018 | SAS-506 | HYDERABAD MSWENERGYSOLUTIONSPVT.LTD | ₹5,87,640 | 2026-08-31 (earliest payment) |

### A7. Duplicate Order IDs — different orders share one ID
The app renamed the second one to "<ID> (2)". Payments for both are attached to the **first**, so they cannot be told apart. Please give each order a unique ID.

| ORDER row | Order ID | Customer | Value | Received (ORDER sheet) |
|---|---|---|---|---|
| 195 | D N16 | SARVESHWARA FOOD | ₹0 | ₹0 |
| 207 | DN 16 | SRINIVASA SEEDS | ₹0 | ₹0 |
| 198 | DN20 | M VENKAT REDDY | ₹0 | ₹0 |
| 206 | DN20 | SRINIVASA SEEDS | ₹0 | ₹0 |
| 588 | SAS-322 | SHERYAKON | ₹10,761 | ₹5,762 |
| 591 | SAS-322 | SRI MALLIKARJUNA CHEMICALS | ₹26,078 | ₹26,078 |

### A8. "Payment Received" in ORDER disagrees with the PAYMENT list (33 orders)
The app trusts the PAYMENT sheet. Please check which side is right.

| ORDER row | Order ID | Customer | ORDER sheet says | PAYMENT rows add up to |
|---|---|---|---|---|
| 377 | SAS-233 | CHEMERIX BIOTECH | ₹0 | ₹23,826 |
| 588 | SAS-322 | SHERYAKON | ₹5,762 | ₹31,840 |
| 685 | SAS-382 | SSS BRICK | ₹0 | ₹38,160 |
| 688 | SB-1054 | AES THERMAL | ₹1,00,600 | ₹2,00,600 |
| 947 | SB-1109-2 | HKM 26-27- MDK-12 - MEDAK | ₹0 | ₹3,19,789.44 |
| 948 | SB-1109-3 | HKM CHARITABLE FOUNDATION INDIA- MNC-9 | ₹0 | ₹3,19,789.44 |
| 949 | SB-1109-4 | HKM CHARITABLE FOUNDATION INDIA- MNC-9 | ₹0 | ₹3,19,789.44 |
| 957 | SB-1109-12 | HKM CHARITABLE FOUNDATION INDIA- KGM-7 | ₹0 | ₹3,19,789.44 |
| 959 | SB-1109-14 | HKM CHARITABLE FOUNDATION INDIA- MLG-7 | ₹0 | ₹3,19,789.44 |
| 961 | SB-1109-16 | HKM CHARITABLE FOUNDATION INDIA- ASB-7 | ₹0 | ₹3,19,789.44 |
| 962 | SB-1109-17 | HKM CHARITABLE FOUNDATION INDIA- ASB-7 | ₹0 | ₹3,19,789.44 |
| 963 | SB-1109-18 | HKM CHARITABLE FOUNDATION INDIA- ASB-7 | ₹0 | ₹3,19,789.44 |
| 964 | SB-1109-19 | HKM CHARITABLE FOUNDATION INDIA- ASB-7 | ₹0 | ₹3,19,789.44 |
| 966 | SB-1109-21 | HKM CHARITABLE FOUNDATION INDIA- SHN-8 | ₹0 | ₹3,19,789.44 |
| 967 | SB-1109-22 | HKM CHARITABLE FOUNDATION INDIA- SHN-8 | ₹0 | ₹3,19,789.44 |
| 968 | SB-1109-23 | HKM CHARITABLE FOUNDATION INDIA- SHN-8 | ₹0 | ₹3,19,789.44 |
| 969 | SB-1109-24 | HKM CHARITABLE FOUNDATION INDIA- SHN-8 | ₹0 | ₹3,19,789.44 |
| 974 | SB-1109-29 | HKM CHARITABLE FOUNDATION INDIA- SHN-7 | ₹0 | ₹3,19,789.44 |
| 975 | SB-1109-30 | HKM CHARITABLE FOUNDATION INDIA- SHN-7 | ₹0 | ₹3,19,789.44 |
| 977 | SB-1109-32 | HKM CHARITABLE FOUNDATION INDIA-MBD-2 | ₹0 | ₹3,19,789.44 |
| 978 | SB-1109-33 | HKM CHARITABLE FOUNDATION INDIA-MBD-2 | ₹0 | ₹3,19,789.44 |
| 979 | SB-1109-34 | HKM CHARITABLE FOUNDATION INDIA-MBD-2 | ₹0 | ₹3,19,789.44 |
| 980 | SB-1109-35 | HKM CHARITABLE FOUNDATION INDIA-MBD-2 | ₹0 | ₹3,19,789.44 |
| 982 | SB-1109-37 | HKM CHARITABLE FOUNDATION INDIA-NKL-2 | ₹0 | ₹3,19,789.44 |
| 983 | SB-1109-38 | HKM CHARITABLE FOUNDATION INDIA-NKL-2 | ₹0 | ₹3,19,789.44 |
| 985 | SB-1109-40 | HKM CHARITABLE FOUNDATION INDIA-SCL-2 | ₹0 | ₹3,19,789.44 |
| 986 | SB-1109-41 | HKM CHARITABLE FOUNDATION INDIA-SCL-2 | ₹0 | ₹3,19,789.44 |
| 988 | SB-1109-43 | HKM CHARITABLE FOUNDATION INDIA-SDP-2 | ₹0 | ₹3,19,789.44 |
| 989 | SB-1109-44 | HKM CHARITABLE FOUNDATION INDIA-SDP-2 | ₹0 | ₹3,19,789.44 |
| 991 | SB-1109-46 | HKM CHARITABLE FOUNDATION INDIA-SPT-2 | ₹0 | ₹3,19,789.44 |
| 992 | SB-1109-47 | HKM CHARITABLE FOUNDATION INDIA-SPT-2 | ₹0 | ₹3,19,789.44 |
| 994 | SB-1109-49 | HKM - CFI / KNR-5 / KARIMNAGAR 2/3 | ₹0 | ₹10,33,585.44 |
| 995 | SB-1109-50 | HKM - CFI / KNR-5 / KARIMNAGAR 3/3 | ₹0 | ₹3,19,789.44 |

### A9. Odd checkbox cells (4) — treated as unticked

| ORDER row | Order ID | Six boxes (Advance … Cleared Issue) |
|---|---|---|
| 40 | SB-906 | "false", "`", "false", "false", "false", "false" |
| 472 | SAS-266 | "false", "false", "", "false", "false", "false" |
| 1008 | SB-1114 | "", "", "", "", "", "" |
| 1010 | SAS-503 | "", "", "", "", "", "" |

### A10. Other oddities

- **PAYMENT sheet header is damaged:** cell A1 (should say "Order ID") contains a payment remark, and row 2 is all `#REF!`. Please restore the header.
- **Customer is a number:** ORDER row 9 (SAS-57) has customer "1090".
- **"Current Stage" shows #REF! on 7 rows** (ORDER rows 166, 167, 168, 169, 170, 256, 469). The app ignores that column and works the stage out from the six boxes.
- **43 orders have no Order Value** (blank, imported as 0) — many are HKM units and "DN" rows.
- **Order IDs typed inconsistently** (e.g. "NIBR - 190" vs "NIBR-190", "D N16", "DN 23"). The app only tidied spacing around hyphens; nothing else was changed.

---

## B. Questions for the client

1. **HKM 50-unit order.** The sheet has 50 separate orders (SB-1109-1 … SB-1109-50). The order value sits only on the first unit of each group (e.g. SB-1109-15-ASIF carries the value for 5 boilers) while payments are booked per unit. Is this how they want to track it? Should the app keep one order per unit, or one order for the whole HKM PO?
2. **Which order belongs to project SB-1109-01-50?** The earlier test Sale Order was removed, so the project currently has no Sale Order link.
3. **Banner totals.** The tiles at the top of ORDER show Total Orders 953 / Total Value ₹101.72 Cr / received ₹80.39 Cr. The rows actually add up to 1,006 orders / ₹102.76 Cr / received ₹80.70 Cr in the ORDER column (₹81.71 Cr in the PAYMENT list). Which rows is the banner meant to exclude? Are "DN" / "Transport" rows real orders?
4. **Column "closed" (TRUE on 11 rows)** vs **Status = CLOSED (41 rows).** What does the "closed" tick mean? It was not imported.
5. **Blank Status on 88 orders.** The app shows them as *Pending*. Correct?
6. **Sales Person.** 122 orders have none (shown as "Unassigned"). Names not in the Settings list: Santosh Reddy (20), DBT (2). We merged the typos AMT / ABT / AMIT / AMITB into "Amit B" — please confirm.
7. **Customers.** 846 orders belong to customers that are not in the app's customer list (334 customers). Names are kept as text. Should we create customer records from the sheet?
8. **Extra columns not imported:** FOLLOW UP DT BY ACCTS, ACCT OWNER, ACTION BY DEPT, EXPECTED DT OF COMPLETION, NEXT DATE OF FOLLOW UP — all empty except three notes in the STATUS column, which were added to Remarks. Are these needed in the app later?

---

## C. Our own to-do (internal)

- Delete the leftover test data: project **SB-1058** and the two "ZZ-…-DELETE-ME" customers.
- Decide the HKM link (question B2).
- `scripts/import-sales-tracker.mjs` is a one-time loader, not a re-sync. After the client fixes the Excel, we write a small fix-up import for A1–A4 (payments can't be corrected on screen yet — see gap 2).

### Known gaps in the app (not data problems)

1. **No "Add order" in the Orders tab.** New orders can only come from Sale Orders → New Sale Order (numbered SO-28…, not the SAS-/NIBR-/SB- scheme in the sheet) or from a quotation. Needs an Add-order sheet where the user types the Order ID.
2. **Payments can't be edited or deleted** (append-only log). A wrong amount, blank date or the 2055 typos can't be fixed on screen. Needs edit (and probably delete-with-reason) on the Payments tab.
3. **Edits are not audit-logged.** Payment logging is; changing an order's value, status, date, invoice or stage ticks is not.
4. **Sales Person is free text.** The Excel already shows how that goes (AMT / ABT / AMITB). Should be a dropdown fed by the Settings list.
5. **Old Sale Orders tab is not paginated** — it now lists all 1,006 orders.
6. **Access:** the Payment Tracker is visible to Sales only. Accounts and Marketing have no view of it.
7. **Not yet checked:** light theme, phone-width layout, and edits by a non-PM Sales login beyond `sales_head`.

- Rollback of the whole import: `DELETE FROM sale_order_payments WHERE created_by='import:sales-tracker-2026-09-19'; DELETE FROM sale_orders WHERE created_by='import:sales-tracker-2026-09-19';`
