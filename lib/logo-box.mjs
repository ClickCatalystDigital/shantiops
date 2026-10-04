// Size of the logo on the PO letterhead, in points: fitted inside 300 x 72, never distorted.
// `wide` = the logo is a full lockup (carries its own name), so no company name is printed beside it.
// Shared by lib/po-pdf.js and the upload preview so the two can't disagree.
export function logoBox(w, h, maxW = 300, maxH = 72) {
  const a = w > 0 && h > 0 ? w / h : 1;
  const height = Math.min(maxH, maxW / a);
  return { width: height * a, height, wide: a >= 1.25 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const eq = (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
  eq(logoBox(100, 100), { width: 72, height: 72, wide: false });
  eq(logoBox(1200, 300), { width: 288, height: 72, wide: true });
  eq(logoBox(1200, 120), { width: 300, height: 30, wide: true });
  eq(logoBox(0, 0), { width: 72, height: 72, wide: false });
  console.log('logo-box ok');
}
