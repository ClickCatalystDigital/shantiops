'use client';

// components/bom-structure/Node3DView.jsx — a light, rotating 3D view on the BOM node's Overview tab.
// No item picked: the node's items and everything under it, laid out side by side (one of each line,
// each scaled to the same cell so a 6 m plate and a 25 NB valve are both readable). An item picked
// (the Overview's "Item relations" picker): that one item.
// Geometry: the Item Master item's own model when the items workbench exported one (looked up by the item's Part No,
// which holds the catalogue code, else its item code)
// (/models/<in|us>/index.json -> <key>.json, made by ../items/sbops_export.py), else a simple shape built
// here from the line's category and size (plate = box, pipe = tube, angle/channel = extruded section).
// three.js loads only when this card mounts; the scene only renders while the card is on screen.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { BoxIcon } from 'lucide-react';

const MARKET = process.env.NEXT_PUBLIC_MARKET === 'NA' || process.env.NEXT_PUBLIC_MARKET === 'US' ? 'us' : 'in';
const MAX_ITEMS = 36; // ponytail: a cap, not paging; a subsystem past this shows the first 36

let indexPromise = null;
const meshCache = new Map();
function modelIndex() {
  indexPromise ||= fetch(`/models/${MARKET}/index.json`).then(r => (r.ok ? r.json() : {})).catch(() => ({}));
  return indexPromise;
}
function loadMesh(key) {
  if (!meshCache.has(key)) meshCache.set(key, fetch(`/models/${MARKET}/${key}.json`).then(r => (r.ok ? r.json() : null)).catch(() => null));
  return meshCache.get(key);
}
function b64(s, Type) {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Type(bytes.buffer);
}

const num = (re, s) => { const m = String(s || '').match(re); return m ? Number(m[1]) : null; };
const NB_OD = { 15: 21.3, 20: 26.9, 25: 33.7, 32: 42.4, 40: 48.3, 50: 60.3, 65: 76.1, 80: 88.9, 100: 114.3, 125: 139.7, 150: 168.3, 200: 219.1 };

function dims(item) {
  let f = {};
  try { f = item.category_fields_json ? JSON.parse(item.category_fields_json) : {}; } catch { f = {}; }
  const text = `${item.material_description || ''} ${item.size_spec || ''}`;
  return { f, text };
}

// A simple stand-in shape (mm) for a line with no exported model.
function fallbackObject(THREE, item, mat) {
  const { f, text } = dims(item);
  const cat = item.category || item.catalog_bom_category || '';
  const g = new THREE.Group();
  const add = (geo, x = 0, y = 0, z = 0, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; g.add(m); return m; };
  const extrude = (shape, len) => add(new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false }), 0, 0, -len / 2);
  // Long stock is drawn as a short cut piece (a few diameters long) so it stays readable next to fittings.
  const cut = d => Math.max(d * 5, 250);
  if (cat === 'plate') {
    const t = Number(f.thickness) || num(/(\d+(?:\.\d+)?)\s*MM/i, text) || 10;
    add(new THREE.BoxGeometry(900, Math.max(t, 8), 600));
  } else if (cat === 'pipe' || cat === 'round') {
    const od = Number(f.diameter) || num(/(\d+(?:\.\d+)?)\s*(?:MM\s*)?OD/i, text) || NB_OD[num(/(\d+)\s*NB/i, text)] || 60;
    const wall = cat === 'round' ? 0 : (num(/X\s*(\d+(?:\.\d+)?)\s*(?:MM\s*)?THK/i, text) || od * 0.08);
    const s = new THREE.Shape(); s.absarc(0, 0, od / 2, 0, Math.PI * 2);
    if (wall) { const h = new THREE.Path(); h.absarc(0, 0, od / 2 - wall, 0, Math.PI * 2, true); s.holes.push(h); }
    extrude(s, cut(od));
  } else if (cat === 'angle' || cat === 'channel' || cat === 'beam' || cat === 'flat' || cat === 'square') {
    const a = num(/(\d+)\s*X/i, text) || Number(f.width) || Number(f.side) || 50;
    const b = num(/\d+\s*X\s*(\d+)/i, text) || (cat === 'channel' ? a / 2 : a);
    const t = num(/\d+\s*X\s*\d+\s*X\s*(\d+)/i, text) || Number(f.thickness) || Math.max(5, a / 10);
    const s = new THREE.Shape();
    if (cat === 'angle') s.setFromPoints([[0, 0], [a, 0], [a, t], [t, t], [t, b], [0, b]].map(p => new THREE.Vector2(...p)));
    else if (cat === 'channel') s.setFromPoints([[0, 0], [b, 0], [b, t], [t, t], [t, a - t], [b, a - t], [b, a], [0, a]].map(p => new THREE.Vector2(...p)));
    else if (cat === 'beam') s.setFromPoints([[0, 0], [b, 0], [b, t], [b / 2 + t / 2, t], [b / 2 + t / 2, a - t], [b, a - t], [b, a], [0, a], [0, a - t], [b / 2 - t / 2, a - t], [b / 2 - t / 2, t], [0, t]].map(p => new THREE.Vector2(...p)));
    else s.setFromPoints([[0, 0], [a, 0], [a, cat === 'square' ? a : t], [0, cat === 'square' ? a : t]].map(p => new THREE.Vector2(...p)));
    extrude(s, cut(a));
  } else if (/VALVE/i.test(text)) {
    const nb = num(/(\d+)\s*NB/i, text) || 50; const fl = NB_OD[nb] ? NB_OD[nb] * 1.8 : nb * 2.5;
    add(new THREE.SphereGeometry(fl * 0.45, 24, 16));
    for (const x of [-fl * 0.7, fl * 0.7]) add(new THREE.CylinderGeometry(fl / 2, fl / 2, fl * 0.12, 32), x, 0, 0, 0).rotation.z = Math.PI / 2;
    add(new THREE.CylinderGeometry(fl * 0.06, fl * 0.06, fl * 0.9, 12), 0, fl * 0.7, 0);
    add(new THREE.TorusGeometry(fl * 0.35, fl * 0.04, 8, 32), 0, fl * 1.15, 0, Math.PI / 2);
  } else if (/GAUGE/i.test(text)) {
    add(new THREE.CylinderGeometry(50, 50, 30, 40), 0, 0, 0, Math.PI / 2);
    add(new THREE.CylinderGeometry(8, 8, 60, 12), 0, -70, 0);
  } else if (/PUMP|MOTOR/i.test(text)) {
    add(new THREE.CylinderGeometry(110, 110, 300, 32), -80, 0, 0).rotation.z = Math.PI / 2;
    add(new THREE.CylinderGeometry(130, 130, 160, 32), 170, 0, 0).rotation.z = Math.PI / 2;
    add(new THREE.BoxGeometry(560, 30, 260), 0, -130, 0);
  } else if (/GASKET/i.test(text)) {
    const nb = num(/(\d+)\s*NB/i, text) || 80; add(new THREE.TorusGeometry((NB_OD[nb] || nb * 1.2) * 0.65, 6, 10, 48), 0, 0, 0, Math.PI / 2);
  } else if (/BOLT|STUD|NUT/i.test(text)) {
    const d = num(/M(\d+)/i, text) || 16; const l = num(/X\s*(\d+)/i, text) || d * 6;
    add(new THREE.CylinderGeometry(d / 2, d / 2, l, 16));
    for (const y of [-l / 2 + d * 0.6, l / 2 - d * 0.6]) add(new THREE.CylinderGeometry(d * 0.9, d * 0.9, d * 0.8, 6), 0, y, 0);
  } else {
    add(new THREE.BoxGeometry(230, 76, 114)); // a brick-sized block for anything else
  }
  return g;
}

function meshObject(THREE, data, mat) {
  const pos = b64(data.p, Int16Array);
  const f = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i++) { const k = i % 3; f[i] = data.o[k] + ((pos[i] + 32767) / 65534) * data.s[k]; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(f, 3));
  geo.setIndex(new THREE.BufferAttribute(b64(data.i, data.w === 4 ? Uint32Array : Uint16Array), 1));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2; // exported models are Z-up
  const g = new THREE.Group(); g.add(m); return g;
}

// Every item under a node (its own, then its sub-nodes'), one per BOM line.
function subtreeItems(node, byId) {
  const all = [...(node.items || [])];
  for (const a of byId.values()) {
    if (a.id === node.id) continue;
    let p = a.parent_id != null ? byId.get(a.parent_id) : null;
    while (p && p.id !== node.id) p = p.parent_id != null ? byId.get(p.parent_id) : null;
    if (p) all.push(...(a.items || []));
  }
  return all;
}

export default function Node3DView({ node, byId, selectedItemId, onShowAll }) {
  const boxRef = useRef(null);
  const [state, setState] = useState({ shown: 0, models: 0 });
  const items = useMemo(() => {
    const all = subtreeItems(node, byId);
    if (selectedItemId) return all.filter(i => String(i.id) === String(selectedItemId));
    return all.slice(0, MAX_ITEMS);
  }, [node, byId, selectedItemId]);
  const total = useMemo(() => subtreeItems(node, byId).length, [node, byId]);
  const sig = items.map(i => `${i.id}:${i.catalog_part_no || i.catalog_item_code || ""}:${i.category || ""}`).join("|");

  useEffect(() => {
    const box = boxRef.current;
    if (!box || !items.length) return undefined;
    let stop = false, raf = 0, visible = true, renderer, scene;
    (async () => {
      const THREE = await import('three');
      const index = await modelIndex();
      if (stop) return;
      const mat = new THREE.MeshStandardMaterial({ color: 0x9aa6b8, metalness: 0.45, roughness: 0.38 });
      const objs = await Promise.all(items.map(async it => {
        const key = index[it.catalog_part_no] || index[it.catalog_item_code];
        const data = key ? await loadMesh(key) : null;
        return { obj: data ? meshObject(THREE, data, mat) : fallbackObject(THREE, it, mat), model: !!data };
      }));
      if (stop) return;
      scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
      const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(3, 5, 4); scene.add(sun);
      // Each object scaled to a 1-unit cell on a fixed grid facing the camera; every cell turns on its own spot.
      const cells = [];
      const w = box.clientWidth, h = box.clientHeight;
      const cols = Math.max(1, Math.min(objs.length, Math.round(Math.sqrt(objs.length * (w / h)))));
      const rows = Math.ceil(objs.length / cols);
      objs.forEach(({ obj }, i) => {
        const bb = new THREE.Box3().setFromObject(obj); const size = bb.getSize(new THREE.Vector3()); const c = bb.getCenter(new THREE.Vector3());
        const cell = new THREE.Group(); obj.position.sub(c); cell.add(obj); cell.scale.setScalar(1 / (Math.max(size.x, size.y, size.z) || 1));
        cell.rotation.x = 0.35; // tip toward the camera a little so flat things read
        const turn = new THREE.Group(); turn.add(cell);
        turn.position.set((i % cols - (cols - 1) / 2) * 1.3, ((rows - 1) / 2 - Math.floor(i / cols)) * 1.3, 0);
        turn.rotation.y = i * 0.7;
        scene.add(turn); cells.push(turn);
      });
      const camera = new THREE.PerspectiveCamera(30, w / h, 0.01, 100);
      const vHalf = THREE.MathUtils.degToRad(15);
      const hHalf = Math.atan(Math.tan(vHalf) * (w / h));
      const dist = Math.max((cols * 1.3 / 2) / Math.tan(hHalf), (rows * 1.3 / 2) / Math.tan(vHalf)) + 0.8;
      camera.position.set(0, 0, dist); camera.lookAt(0, 0, 0);
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.setSize(w, h);
      box.appendChild(renderer.domElement);
      setState({ shown: objs.length, models: objs.filter(o => o.model).length });
      const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }); io.observe(box);
      const tick = () => {
        if (stop) { io.disconnect(); return; }
        if (visible && !document.hidden) { for (const c of cells) c.rotation.y += 0.008; renderer.render(scene, camera); }
        raf = requestAnimationFrame(tick);
      };
      tick();
    })();
    return () => {
      stop = true; cancelAnimationFrame(raf);
      scene?.traverse(o => { o.geometry?.dispose(); });
      renderer?.dispose(); renderer?.domElement.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  if (!total) return null;
  const picked = selectedItemId && items[0];
  return (
    <div className="flex flex-col gap-1.5 border-t pt-3">
      <div className="flex items-center gap-2">
        <BoxIcon className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">{picked ? `3D · BM-${picked.id} ${picked.material_description}` : '3D · this subsystem'}</span>
        {picked && onShowAll && <Button size="xs" variant="ghost" className="ml-auto" onClick={onShowAll}>Show whole subsystem</Button>}
      </div>
      <div ref={boxRef} className="h-64 w-full overflow-hidden rounded-md border bg-gradient-to-b from-muted/30 to-muted/70" />
      <p className="text-xs text-muted-foreground">
        {picked ? 'Pick another item in Item relations below, or show the whole subsystem.'
          : `${state.shown} of ${total} item${total === 1 ? '' : 's'} shown, one of each line${total > MAX_ITEMS ? ` (first ${MAX_ITEMS})` : ''}. Pick an item below to see it alone.`}
        {state.shown > 0 && ` ${state.models} from the item library, the rest drawn from size.`}
      </p>
    </div>
  );
}
