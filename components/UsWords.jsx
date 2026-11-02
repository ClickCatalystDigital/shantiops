'use client';

// US build only (app/layout.js renders it when IS_US): puts the screen's Indian vocabulary into US English as it
// renders (Enquiry → Inquiry, Quotation → Estimate, Dispatch → Shipping, GST → Sales tax…), using the one word map in
// lib/market.js. Text nodes, placeholders, titles and the tab title; it watches for new content. Values typed into
// inputs are never touched.
import { useEffect } from 'react';
import { usWords } from '@/lib/market';

export default function UsWords() {
  useEffect(() => {
    const fixNode = n => {
      if (n.nodeType === 3) { const t = usWords(n.nodeValue); if (t !== n.nodeValue) n.nodeValue = t; return; }
      if (n.nodeType !== 1 || n.closest?.('script,style,textarea,[contenteditable=true]')) return;
      for (const a of ['placeholder', 'title', 'aria-label']) {
        const v = n.getAttribute?.(a); if (v) { const t = usWords(v); if (t !== v) n.setAttribute(a, t); }
      }
      const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      for (let x = w.nextNode(); x; x = w.nextNode()) {
        if (x.nodeType === 3) { if (!x.parentElement?.closest('script,style,textarea')) { const t = usWords(x.nodeValue); if (t !== x.nodeValue) x.nodeValue = t; } }
        else for (const a of ['placeholder', 'title', 'aria-label']) { const v = x.getAttribute(a); if (v) { const t = usWords(v); if (t !== v) x.setAttribute(a, t); } }
      }
    };
    fixNode(document.body);
    const t = usWords(document.title); if (t !== document.title) document.title = t;
    const mo = new MutationObserver(list => {
      for (const m of list) {
        if (m.type === 'characterData') fixNode(m.target);
        else m.addedNodes.forEach(fixNode);
      }
      const tt = usWords(document.title); if (tt !== document.title) document.title = tt;
    });
    mo.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    return () => mo.disconnect();
  }, []);
  return null;
}
