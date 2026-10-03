// lib/nameplate-sticker-pdf.js — printable QR sticker for the boiler nameplate (70 x 40 mm, one
// page per unit). The QR opens that order's customer portal page, which already shows
// certificates, drawings and service visits; the customer signs in to see it.
import React from 'react';
import { Document, Page, View, Text, Image, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import QRCode from 'qrcode';

const MM = 2.8346;
const s = StyleSheet.create({
  page: { padding: 8, flexDirection: 'row', alignItems: 'center', fontFamily: 'Helvetica', color: '#111' },
  left: { flex: 1, paddingRight: 6 },
  company: { fontSize: 7, fontFamily: 'Helvetica-Bold', letterSpacing: 0.4 },
  no: { fontSize: 13, fontFamily: 'Helvetica-Bold', marginTop: 5 },
  line: { fontSize: 6.5, color: '#333', marginTop: 2 },
  hint: { fontSize: 5.5, color: '#555', marginTop: 6 },
  qr: { width: 84, height: 84 },
});

// stickers: [{ company, project_no, customer_name, model, url }]
export async function renderNameplateStickerPdf(stickers) {
  const pages = await Promise.all(stickers.map(async st => ({ ...st, qr: await QRCode.toDataURL(st.url, { margin: 0, width: 400 }) })));
  return renderToBuffer(
    <Document title="Nameplate QR stickers">
      {pages.map((p, i) => (
        <Page key={i} size={[70 * MM, 40 * MM]} style={s.page}>
          <View style={s.left}>
            <Text style={s.company}>{String(p.company || '').toUpperCase()}</Text>
            <Text style={s.no}>{p.project_no}</Text>
            {p.model ? <Text style={s.line}>{p.model}</Text> : null}
            {p.customer_name ? <Text style={s.line}>{p.customer_name}</Text> : null}
            <Text style={s.hint}>Scan for certificates, drawings and service history</Text>
          </View>
          <Image style={s.qr} src={p.qr} />
        </Page>
      ))}
    </Document>
  );
}
