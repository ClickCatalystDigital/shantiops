// node lib/legacy-crm-import-selfcheck.mjs
import assert from 'node:assert/strict';
import { parseCsv, parseProducts, parseStageCounts, parseCustomerSummary, groupCustomers } from './legacy-crm-import.mjs';

assert.deepEqual(parseCsv('a,"b,c","x\n""y"""\n1,2,3'), [['a', 'b,c', 'x\n"y"'], ['1', '2', '3']]);
assert.deepEqual(parseCsv('a,GLASS 3/4\\" X 14\\",c\n1,2,3'), [['a', 'GLASS 3/4\\" X 14\\"', 'c'], ['1', '2', '3']]);
assert.deepEqual(parseStageCounts('1LEAD - COLD \n  0LEAD - HOT0LEAD PROJECT  - DROPED2PROPOSALS0HOT OFFERS0ORDER RECEIVED0ORDER LOST 1FOLLOW UP STAGE'),
  { 'Lead - Cold': 1, 'Proposals': 2, 'Follow up stage': 1 });

const P = 'Product Code,Product Name,HSN/SAC Code,Category,Description,Type,SubType,Unit,Price (in PC) ,Cost Price(in PC),GST Rate(%),Premium Price(in PC),List Price(in PC), AMC Std Price,Warranty Period(in Days),Upgradable,Life Span,LifeSpan In,Spares Required,Pit Marking,Calibration,No.of Services in the warranty ,Serviceable Product ,Others,AMC,Warranty,Service Frequency,Service Frequency In\n'
  + 'SB-1,BOILER 1,84021200,Standard Product,Desc,AGRO FLAME,, SET,1490000.0,0.0,18.0,0.0,0.0,0.0,0,Y,0.0,year,Y,N,Y,0,true,,0,0,0.0,year\n'
  + 'SB-1,BOILER 1B,,Standard Product,,AGRO FLAME,,NOS.,0.0,0.0,0.0,0.0,0.0,0.0,365,N,0.0,,Y,Y,Y,0,false,,0,0,0.0,\n';
const { products, issues } = parseProducts(P);
assert.equal(products.length, 2);
assert.equal(products[0].product_code, 'SB-1'); assert.equal(products[1].product_code, 'SB-1 (2)'); assert.equal(products[1].legacy_code, 'SB-1');
assert.equal(products[0].unit, 'Set'); assert.equal(products[1].unit, 'Nos');
assert.equal(products[0].gst_pct, 18); assert.equal(products[1].gst_pct, null); assert.equal(products[1].price, null);
assert.equal(products[1].warranty_days, 365); assert.equal(products[0].serviceable, 1);
assert.deepEqual(JSON.parse(products[0].attributes_json), { upgradable: true, spares_required: true, pit_marking: false, calibration: true });
assert.equal(issues.sharedCodes.length, 1); assert.equal(issues.zeroGst, 1);

const C = 'title\nx\ny\nS.N.,Organization Code,Organization,"Open \n Sales Call",Close Sales Call,Products,Funnel Stage,A/c Manager,District/Sub Location,Total Quote Price,Total Orders,Total Orders Value,Total Collection,AMC,AMC Value\n'
  + '1,C1,M/s. Konkan Sugars Pvt Ltd,1,0,"BOILER-SF-200,CHIMNEY",1LEAD - COLD 0LEAD - HOT,Amit B,Pune,100.0,1,500.0,50.0,0,0.0\n'
  + '2,,Konkan Sugars Limited,0,1,,1ORDER LOST,"Amit B ,Sales Desk",,0.0,0,0.0,0.0,0,0.0\n'
  + '3,,Anil,1,0,,1LEAD - COLD,Sales Desk,,0.0,0,0.0,0.0,0,0.0\n'
  + '4,,Anil,1,0,,1LEAD - COLD,Sales Desk,Pune,0.0,0,0.0,0.0,0,0.0\n'
  + '5,C9,Konkan Sugars,1,0,,1LEAD - COLD,Sales Desk,,0.0,0,0.0,0.0,0,0.0\n'
  + 'broken,row\n';
const { rows, broken } = parseCustomerSummary(C, 'part1');
assert.equal(rows.length, 4); assert.equal(broken.length, 1);    // the stray line joins row 5, which then no longer adds up
assert.deepEqual(rows[1].managers, ['Amit B', 'Sales Desk']);
const g = groupCustomers(rows);
assert.equal(g.length, 3);                       // Konkan (rows 1+2 merged), Anil, Anil (single word: not merged)
assert.equal(g[0].summary.merged_rows, 2); assert.deepEqual(g[0].summary.stages, { 'Lead - Cold': 1, 'Order Lost': 1 });
assert.deepEqual(g[0].managers, ['Amit B', 'Sales Desk']); assert.equal(g[0].summary.order_value, 500);

// Unquoted commas in Products are recovered; a line break inside the Funnel cell is rejoined.
const H = 'S.N.,a,b,c,d,e,f,g,h,i,j,k,l,m,n\n';
const R = parseCustomerSummary(H
  + '7,C7,Etico Chemicals,1,1,FLANGES,MS,T/H,"2LEAD - COLD\n',  'p');
assert.equal(R.rows.length, 0);
const R2 = parseCustomerSummary(H + '7,C7,Etico Chemicals,1,1,FLANGES,MS,T/H,2LEAD - COLD,Amit B,,0.0,0,0.0,0.0,0,0.0\n8,C7,Etico Chem Pvt,1,0,,1LEAD - HOT,Amit B,,0.0,0,0.0,0.0,0,0.0\n9,C8,Konkan Sugars,1,0,,1LEAD - HOT,x,,0,0,0,0,0,0\n10,C9,Konkan Sugars Ltd,1,0,,1LEAD - HOT,x,,0,0,0,0,0,0\n', 'p');
assert.equal(R2.rows.length, 4); assert.deepEqual(R2.rows[0].products, ['FLANGES', 'MS', 'T/H']);
const g2 = groupCustomers(R2.rows);
assert.equal(g2.length, 3);
const g3 = groupCustomers(parseCustomerSummary(H + '1,,Anil Kumar,1,0,,1LEAD - HOT,x,Pune,0,0,0,0,0,0\n2,,Anil Kumar,1,0,,1LEAD - HOT,x,Delhi,0,0,0,0,0,0\n3,,Anil Kumar,1,0,,1LEAD - HOT,x,,0,0,0,0,0,0\n', 'p').rows);
assert.equal(g3.length, 2);                      // different districts stay apart; the blank-district row joins the first                      // C7 rows merged by code; Konkan C8 vs C9 kept apart (codes differ)
console.log('legacy-crm-import selfcheck: all assertions passed');
