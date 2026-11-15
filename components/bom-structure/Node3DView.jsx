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

// Starts three.js in `box`, calls build(THREE, scene) for the meshes, frames them and turns them. Stops off screen.
function useScene(boxRef, build, deps) {
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return undefined;
    let stop = false, raf = 0, visible = true, renderer, scene;
    (async () => {
      const THREE = await import('three');
      scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
      const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(3, 5, 4); scene.add(sun);
      const w = box.clientWidth, h = box.clientHeight;
      const camera = new THREE.PerspectiveCamera(30, w / h, 0.01, 1e6);
      const tick0 = await build(THREE, scene, camera, w, h);
      if (stop || !tick0) return;
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.setSize(w, h);
      box.appendChild(renderer.domElement);
      const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }); io.observe(box);
      const tick = () => {
        if (stop) { io.disconnect(); return; }
        if (visible && !document.hidden) { tick0(); renderer.render(scene, camera); }
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
  }, deps);
}

const metal = (THREE, opts = {}) => new THREE.MeshStandardMaterial({ color: 0x9aa6b8, metalness: 0.45, roughness: 0.38, side: THREE.DoubleSide, ...opts });

// One of each line, each in its own cell, turning in place. Used for a single item and for nodes with no assembly.
function ItemGrid3D({ items, onCount, className = 'h-64' }) {
  const boxRef = useRef(null);
  const sig = items.map(i => `${i.id}:${i.catalog_part_no || i.catalog_item_code || ''}:${i.category || ''}`).join('|');
  useScene(boxRef, async (THREE, scene, camera, w, h) => {
    const index = await modelIndex();
    const mat = metal(THREE);
    const objs = await Promise.all(items.map(async it => {
      const key = index[it.catalog_part_no] || index[it.catalog_item_code];
      const data = key ? await loadMesh(key) : null;
      return { obj: data ? meshObject(THREE, data, mat) : fallbackObject(THREE, it, mat), model: !!data };
    }));
    const cells = [];
    const cols = Math.max(1, Math.min(objs.length, Math.round(Math.sqrt(objs.length * (w / h)))));
    const rows = Math.ceil(objs.length / cols);
    objs.forEach(({ obj }, i) => {
      const bb = new THREE.Box3().setFromObject(obj); const size = bb.getSize(new THREE.Vector3()); const c = bb.getCenter(new THREE.Vector3());
      const cell = new THREE.Group(); obj.position.sub(c); cell.add(obj); cell.scale.setScalar(1 / (Math.max(size.x, size.y, size.z) || 1));
      cell.rotation.x = 0.35;
      const turn = new THREE.Group(); turn.add(cell);
      turn.position.set((i % cols - (cols - 1) / 2) * 1.3, ((rows - 1) / 2 - Math.floor(i / cols)) * 1.3, 0);
      turn.rotation.y = i * 0.7;
      scene.add(turn); cells.push(turn);
    });
    const vHalf = THREE.MathUtils.degToRad(15), hHalf = Math.atan(Math.tan(vHalf) * (w / h));
    camera.position.set(0, 0, Math.max((cols * 1.3 / 2) / Math.tan(hHalf), (rows * 1.3 / 2) / Math.tan(vHalf)) + 0.8);
    camera.lookAt(0, 0, 0);
    onCount?.(objs.filter(o => o.model).length);
    return () => { for (const c of cells) c.rotation.y += 0.008; };
  }, [sig]);
  return <div ref={boxRef} className={`${className} w-full overflow-hidden rounded-md border bg-gradient-to-b from-muted/30 to-muted/70`} />;
}

// The single picked item, for the item's own card.
export function Item3D({ item }) {
  if (!item) return null;
  return <ItemGrid3D key={item.id} items={[item]} className="h-48" />;
}

// Subsystem assemblies of a 3-pass shell boiler, made by ../items/sbops_assemblies.py from the calc-set samples
// (public/models/assemblies/<subsystem>-<capacity>.json). Which one a node shows follows its name; a System node shows all three.
const SUBSYSTEMS = [['shell', /shell|body|pressure part/i], ['mountings', /mounting|fitting/i], ['feed', /feed/i]];
export function subsystemKeys(node, byId) {
  const own = SUBSYSTEMS.filter(([, re]) => re.test(node.name || '')).map(([k]) => k);
  if (own.length) return own;
  const children = [...byId.values()].filter(a => a.parent_id === node.id);
  const viaChildren = SUBSYSTEMS.filter(([, re]) => children.some(c => re.test(c.name || ''))).map(([k]) => k);
  return viaChildren.length > 1 ? viaChildren : [];
}
let asmIndex = null;
const asmCache = new Map();
const loadJson = url => { if (!asmCache.has(url)) asmCache.set(url, fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null)); return asmCache.get(url); };

function Assembly3D({ keys, capacity, highlight, onInfo }) {
  const boxRef = useRef(null);
  useScene(boxRef, async (THREE, scene, camera, w, h) => {
    asmIndex ||= loadJson('/models/assemblies/index.json');
    const sizes = (await asmIndex) || [];
    if (!sizes.length) return null;
    const cap = parseFloat(capacity) || 2000;
    const size = sizes.reduce((b, s) => (Math.abs(s.capacity - cap) < Math.abs(b.capacity - cap) ? s : b));
    const files = (await Promise.all(keys.map(k => loadJson(`/models/assemblies/${k}-${size.capacity}.json`)))).filter(Boolean);
    const re = highlight ? highlight : null;
    const group = new THREE.Group();
    const shown = [], hits = [];
    let shellDone = false;
    for (const f of files) {
      for (const p of f.parts) {
        if (p.context) { if (shellDone || keys.includes('shell')) continue; shellDone = true; }
        const hit = re && p.match && new RegExp(p.match, 'i').test(re);
        const mat = p.context ? metal(THREE, { transparent: true, opacity: 0.18, depthWrite: false })
          : hit ? metal(THREE, { color: 0xf08a24, emissive: 0x6a2a00 })
            : re ? metal(THREE, { transparent: true, opacity: 0.35 }) : metal(THREE);
        const o = meshObject(THREE, p.mesh, mat);
        o.children[0].rotation.x = 0; // assemblies are already Y-up
        group.add(o);
        if (!p.context) { shown.push(p.name); if (hit) hits.push(p.name); }
      }
    }
    const bb = new THREE.Box3().setFromObject(group);
    group.position.sub(bb.getCenter(new THREE.Vector3()));
    const pivot = new THREE.Group(); pivot.add(group); pivot.rotation.y = -0.6; scene.add(pivot);
    const r = bb.getSize(new THREE.Vector3()).length() / 2;
    const vHalf = THREE.MathUtils.degToRad(15), hHalf = Math.atan(Math.tan(vHalf) * (w / h));
    const dist = r / Math.sin(Math.min(vHalf, hHalf)) * 0.9;
    camera.position.set(0, dist * 0.35, dist * 0.94); camera.lookAt(0, 0, 0);
    onInfo?.({ parts: shown, hits, capacity: size.capacity });
    return () => { pivot.rotation.y += 0.004; };
  }, [keys.join(), capacity, highlight]);
  return <div ref={boxRef} className="h-72 w-full overflow-hidden rounded-md border bg-gradient-to-b from-muted/30 to-muted/70" />;
}

export default function Node3DView({ node, byId, capacity, selectedItemId }) {
  const [info, setInfo] = useState(null);
  const [models, setModels] = useState(0);
  const all = useMemo(() => subtreeItems(node, byId), [node, byId]);
  const keys = useMemo(() => subsystemKeys(node, byId), [node, byId]);
  const picked = selectedItemId ? all.find(i => String(i.id) === String(selectedItemId)) : null;
  const text = picked ? `${picked.material_description || ''} ${picked.size_spec || ''}` : null;
  if (keys.length) {
    return (
      <div className="flex flex-col gap-1.5 border-t pt-3">
        <div className="flex items-center gap-2">
          <BoxIcon className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">3D · {node.name} assembly</span>
        </div>
        <Assembly3D keys={keys} capacity={capacity} highlight={text} onInfo={setInfo} />
        <p className="text-xs text-muted-foreground">
          {info ? `${info.parts.join(', ')}. Sized from the ${info.capacity} kg/hr design template; nozzle and pipe positions are illustrative.` : 'Loading…'}
          {picked && info && (info.hits.length ? ` BM-${picked.id} is shown in orange.` : ` BM-${picked.id} isn't a part of this model.`)}
        </p>
      </div>
    );
  }
  if (!all.length) return null;
  const items = all.slice(0, MAX_ITEMS);
  return (
    <div className="flex flex-col gap-1.5 border-t pt-3">
      <div className="flex items-center gap-2">
        <BoxIcon className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">3D · items under {node.name}</span>
      </div>
      <ItemGrid3D items={items} onCount={setModels} />
      <p className="text-xs text-muted-foreground">
        No assembly model for this node, so its items are shown side by side ({items.length} of {all.length}{all.length > MAX_ITEMS ? `, first ${MAX_ITEMS}` : ''}). {models} from the item library, the rest drawn from size.
      </p>
    </div>
  );
}
