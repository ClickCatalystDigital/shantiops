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

// Use only explicitly named material families to choose an illustrative surface finish.
function itemMaterial(THREE, item) {
  const { f, text } = dims(item);
  const description = [item.moc, f.material, f.grade, text].filter(Boolean).join(' ');
  let color = 0x929da8, roughness = 0.47, metalness = 0.65;
  if (/\b(brass|bronze|copper)\b/i.test(description)) {
    color = /copper/i.test(description) ? 0xbb7659 : 0xb39655;
  } else if (/\b(stainless|SS[ -]?(?:304|316)L?)\b/i.test(description)) {
    color = 0xc2c9cc; roughness = 0.31; metalness = 0.85;
  } else if (/\b(EPDM|rubber|neoprene|graphite)\b/i.test(description)) {
    color = 0x41464a; roughness = 0.88; metalness = 0.05;
  } else if (/\b(PTFE|ceramic)\b/i.test(description)) {
    color = 0xe6e4da; roughness = 0.62; metalness = 0.04;
  }
  const mat = metal(THREE, { color, roughness, metalness, flatShading: false });
  if (/\bflange\b/i.test(text) && !/valve|gasket/i.test(text)) {
    // A filtered circular lay on axial faces catches light as a machined flange turns.
    mat.onBeforeCompile = shader => {
      shader.vertexShader = 'varying vec3 localPoint; varying vec3 localNormal;\n' + shader.vertexShader
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nlocalPoint = position; localNormal = normal;');
      shader.fragmentShader = 'varying vec3 localPoint; varying vec3 localNormal;\n' + shader.fragmentShader
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          float axial = smoothstep(0.85, 0.99, abs(normalize(localNormal).z));
          float phase = length(localPoint.xy) * 2.7;
          float lay = cos(phase) * (1.0 - smoothstep(0.4, 2.9, fwidth(phase)));
          roughnessFactor = mix(0.52, 0.30 + 0.09 * lay, axial);
        `);
    };
  }
  return mat;
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
  // Revolved sections show the bore and machined shoulders in fittings without an exported mesh.
  const turned = profile => add(new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 64));
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
    const nb = num(/(\d+)\s*NB/i, text) || 80; const bore = (NB_OD[nb] || nb * 1.2) / 2;
    turned([[bore, -2], [bore * 1.5, -2], [bore * 1.5, 2], [bore, 2], [bore, -2]]);
  } else if (/BOLT|STUD|NUT/i.test(text)) {
    const d = num(/M(\d+)/i, text) || 16; const l = num(/X\s*(\d+)/i, text) || d * 6;
    add(new THREE.CylinderGeometry(d / 2, d / 2, l, 16));
    for (const y of [-l / 2 + d * 0.6, l / 2 - d * 0.6]) add(new THREE.CylinderGeometry(d * 0.9, d * 0.9, d * 0.8, 6), 0, y, 0);
  } else {
    add(new THREE.BoxGeometry(230, 76, 114)); // a brick-sized block for anything else
  }
  return g;
}

function meshObject(THREE, data, mat, creaseNormals) {
  const pos = b64(data.p, Int16Array);
  const f = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i++) { const k = i % 3; f[i] = data.o[k] + ((pos[i] + 32767) / 65534) * data.s[k]; }
  let geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(f, 3));
  geo.setIndex(new THREE.BufferAttribute(b64(data.i, data.w === 4 ? Uint32Array : Uint16Array), 1));
  if (creaseNormals && (data.flatShading || data.colorRuns)) {
    const indexed = geo;
    geo = creaseNormals(indexed, Math.PI / 5);
    indexed.dispose();
  } else {
    geo.computeVertexNormals();
    if (data.flatShading) mat.flatShading = true;
  }
  if (data.colorRuns) {
    if (geo.index) {
      const indexed = geo;
      geo = indexed.toNonIndexed();
      indexed.dispose();
    }
    const colors = new Float32Array(geo.attributes.position.count * 3);
    const palette = new Map((data.finishes || []).map(([r, g, b, m, rough]) => [[r, g, b].join(','), [m, rough]]));
    const finish = palette.size ? new Float32Array(geo.attributes.position.count * 2) : null;
    let offset = 0, finishOffset = 0;
    for (const [faces, r, g, b] of data.colorRuns) {
      const surface = finish && (palette.get([r, g, b].join(',')) || [0.28, 0.39]);
      for (let vertex = 0; vertex < faces * 3; vertex++) {
        colors[offset++] = r; colors[offset++] = g; colors[offset++] = b;
        if (surface) { finish[finishOffset++] = surface[0]; finish[finishOffset++] = surface[1]; }
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    mat.color.setHex(0xffffff); mat.vertexColors = true;
    // Paint and printed faces retain diffuse color under direct lighting.
    mat.metalness = 0.28; mat.roughness = 0.39;
    if (finish) {
      geo.setAttribute('surfaceFinish', new THREE.BufferAttribute(finish, 2));
      mat.onBeforeCompile = shader => {
        shader.vertexShader = 'attribute vec2 surfaceFinish; varying vec2 vFinish;\n' + shader.vertexShader
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFinish = surfaceFinish;');
        shader.fragmentShader = 'varying vec2 vFinish;\n' + shader.fragmentShader
          .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vFinish.x;')
          .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vFinish.y;');
      };
    }
  }
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

let studioMap;
function itemStudio(THREE) {
  if (studioMap) return studioMap;
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const sky = ctx.createLinearGradient(0, 0, 0, 256);
  sky.addColorStop(0, '#abb7c4'); sky.addColorStop(0.47, '#56606b'); sky.addColorStop(0.52, '#25272a'); sky.addColorStop(1, '#606168');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = '#fffaf1'; ctx.fillRect(45, 24, 144, 76);
  ctx.fillStyle = '#ecf3ff'; ctx.fillRect(300, 32, 48, 120);
  studioMap = new THREE.CanvasTexture(canvas);
  studioMap.mapping = THREE.EquirectangularReflectionMapping;
  studioMap.colorSpace = THREE.SRGBColorSpace;
  return studioMap;
}

// Fit the item's turned silhouette to the card, including the camera elevation.
function itemDistance(THREE, object, camera) {
  object.updateWorldMatrix(true, true);
  const point = new THREE.Vector3();
  const slopeY = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const slopeX = slopeY * camera.aspect;
  const sin = Math.sin(0.34), cos = Math.cos(0.34);
  let distance = camera.near * 2;
  object.traverse(child => {
    if (!child.isMesh) return;
    const positions = child.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(child.matrixWorld);
      const radius = Math.hypot(point.x, point.z), y = point.y;
      distance = Math.max(distance, y * sin + radius * Math.hypot(cos, 1 / slopeX),
        y * (sin + cos / slopeY) + radius * Math.abs(cos - sin / slopeY),
        y * (sin - cos / slopeY) + radius * (cos + sin / slopeY));
    }
  });
  return 1.12 * distance;
}

function groundItem(THREE, scene, obj, camera, distance, groundY) {
  const key = scene.children.find(child => child.isDirectionalLight);
  key.castShadow = true;
  key.shadow.mapSize.set(512, 512);
  key.shadow.radius = 4;
  key.shadow.blurSamples = 8;
  Object.assign(key.shadow.camera, { left: -1.15, right: 1.15, top: 1.15, bottom: -1.15, near: 0.1, far: 12 });
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.normalBias = 0.002;
  obj.traverse(child => { if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; } });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.ShadowMaterial({ opacity: 0.17 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = groundY - 0.004;
  floor.receiveShadow = true;
  scene.add(floor);
  camera.position.set(0, distance * Math.sin(0.34), distance * Math.cos(0.34));
  camera.lookAt(0, 0, 0);
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
      scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.05));
      const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(3, 5, 4); scene.add(sun);
      const fill = new THREE.DirectionalLight(0xffffff, 0.9); fill.position.set(-4, 2, -3); scene.add(fill);
      const w = box.clientWidth, h = box.clientHeight;
      const camera = new THREE.PerspectiveCamera(30, w / h, 0.01, 1e6);
      const tick0 = await build(THREE, scene, camera, w, h);
      if (stop || !tick0) return;
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      if (scene.environment) {
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.shadowMap.enabled = scene.children.some(o => o.isLight && o.castShadow);
        renderer.shadowMap.type = THREE.VSMShadowMap;
      }
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
      scene?.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); o.shadow?.dispose(); });
      renderer?.dispose(); renderer?.domElement.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

const metal = (THREE, opts = {}) => new THREE.MeshStandardMaterial({ color: 0xb4bfcc, metalness: 0.25, roughness: 0.5, flatShading: true, side: THREE.DoubleSide, ...opts });

// One of each line, each in its own cell, turning in place. Used for a single item and for nodes with no assembly.
function ItemGrid3D({ items, onCount, className = 'h-64' }) {
  const boxRef = useRef(null);
  const sig = items.map(itemSig).join('|');
  const [basis, setBasis] = useState('');
  useScene(boxRef, async (THREE, scene, camera, w, h) => {
    scene.environment = itemStudio(THREE);
    const [index, { toCreasedNormals }] = await Promise.all([
      modelIndex(), import('three/addons/utils/BufferGeometryUtils.js'),
    ]);
    const objs = await Promise.all(items.map(async it => {
      const mat = itemMaterial(THREE, it);
      const key = index[it.catalog_part_no] || index[it.catalog_item_code];
      const data = key ? await loadMesh(key) : null;
      return { obj: data ? meshObject(THREE, data, mat, toCreasedNormals) : fallbackObject(THREE, it, mat), model: !!data, basis: data?.modelAvailability };
    }));
    const cells = [];
    const cols = Math.max(1, Math.min(objs.length, Math.round(Math.sqrt(objs.length * (w / h)))));
    const rows = Math.ceil(objs.length / cols);
    let groundY;
    objs.forEach(({ obj }, i) => {
      const bb = new THREE.Box3().setFromObject(obj); const size = bb.getSize(new THREE.Vector3()); const c = bb.getCenter(new THREE.Vector3());
      const cell = new THREE.Group(); obj.position.sub(c); cell.add(obj); cell.scale.setScalar(1 / (Math.max(size.x, size.y, size.z) || 1));
      if (objs.length === 1) groundY = -size.y * cell.scale.x / 2;
      else cell.rotation.x = 0.35;
      const turn = new THREE.Group(); turn.add(cell);
      turn.position.set((i % cols - (cols - 1) / 2) * 1.3, ((rows - 1) / 2 - Math.floor(i / cols)) * 1.3, 0);
      turn.rotation.y = -0.78 + i * 0.7;
      scene.add(turn); cells.push(turn);
    });
    const vHalf = THREE.MathUtils.degToRad(15), hHalf = Math.atan(Math.tan(vHalf) * (w / h));
    const distance = objs.length === 1
      ? itemDistance(THREE, cells[0], camera)
      : Math.max((cols * 1.3 / 2) / Math.tan(hHalf), (rows * 1.3 / 2) / Math.tan(vHalf)) + 0.8;
    camera.position.set(0, 0, distance);
    camera.lookAt(0, 0, 0);
    if (objs.length === 1) groundItem(THREE, scene, cells[0], camera, distance, groundY);
    const explanations = {
      ILLUSTRATIVE_PROXY: 'Illustrative model',
      PARTIAL_DIMENSION_PREVIEW: 'Partial dimensional preview',
      EXISTING_REFERENCE: 'Reference geometry',
      EXISTING_PROCEDURAL: 'Procedural geometry',
    };
    setBasis([...new Set(objs.map(o => explanations[o.basis]).filter(Boolean))].join(' · '));
    onCount?.(objs.filter(o => o.model).length);
    return () => { for (const c of cells) c.rotation.y += 0.008; };
  }, [sig]);
  return <div><div ref={boxRef} className={`${className} w-full overflow-hidden rounded-md border bg-gradient-to-b from-muted/30 to-muted/70`} />
    {basis && <p className="mt-1 text-xs text-muted-foreground">{basis}</p>}</div>;
}

const itemSig = i => `${i.id}:${i.catalog_part_no || i.catalog_item_code || ''}:${i.category || ''}:${i.material_description || ''}:${i.size_spec || ''}:${i.category_fields_json || ''}`;

// Square still pictures for a list of items: one shared off-screen renderer draws each item once (queued, cached),
// so a long list costs no live WebGL contexts.
const thumbCache = new Map();
let thumbChain = Promise.resolve();
let thumbRenderer = null;
function thumbFor(item) {
  const sig = itemSig(item);
  if (thumbCache.has(sig)) return thumbCache.get(sig);
  const job = thumbChain.then(async () => {
    const THREE = await import('three');
    const [index, { toCreasedNormals }] = await Promise.all([
      modelIndex(), import('three/addons/utils/BufferGeometryUtils.js'),
    ]);
    const key = index[item.catalog_part_no] || index[item.catalog_item_code];
    const data = key ? await loadMesh(key) : null;
    const mat = itemMaterial(THREE, item);
    const obj = data ? meshObject(THREE, data, mat, toCreasedNormals) : fallbackObject(THREE, item, mat);
    const scene = new THREE.Scene();
    scene.environment = itemStudio(THREE);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.05));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4); sun.position.set(3, 5, 4); scene.add(sun);
    const bb = new THREE.Box3().setFromObject(obj); const c = bb.getCenter(new THREE.Vector3()); const size = bb.getSize(new THREE.Vector3());
    obj.position.sub(c);
    const g = new THREE.Group(); g.add(obj); g.scale.setScalar(1 / (Math.max(size.x, size.y, size.z) || 1)); g.rotation.set(0, -0.7, 0);
    scene.add(g);
    const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100); camera.position.set(0, 0, 2.5); camera.lookAt(0, 0, 0);
    groundItem(THREE, scene, g, camera, itemDistance(THREE, g, camera), -size.y * g.scale.x / 2);
    thumbRenderer ||= new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    thumbRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    thumbRenderer.shadowMap.enabled = true;
    thumbRenderer.shadowMap.type = THREE.VSMShadowMap;
    thumbRenderer.setSize(128, 128, false);
    thumbRenderer.render(scene, camera);
    scene.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); o.shadow?.dispose(); });
    return thumbRenderer.domElement.toDataURL('image/png');
  }).catch(() => null);
  thumbChain = job;
  thumbCache.set(sig, job);
  return job;
}

export function ItemThumb({ item, className = 'size-12' }) {
  const ref = useRef(null);
  const [src, setSrc] = useState(null);
  const sig = itemSig(item);
  useEffect(() => {
    let live = true;
    const el = ref.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { io.disconnect(); thumbFor(item).then(u => live && setSrc(u)); } });
    io.observe(el);
    return () => { live = false; io.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return (
    <div ref={ref} className={`${className} shrink-0 overflow-hidden rounded-md border bg-gradient-to-b from-muted/30 to-muted/70`}>
      {src && <img src={src} alt="" className="size-full object-contain" />}
    </div>
  );
}

// The single picked item, for the item's own card.
export function Item3D({ item, className = 'h-48' }) {
  if (!item) return null;
  return <ItemGrid3D key={item.id} items={[item]} className={className} />;
}

// Subsystem assemblies of a 3-pass shell boiler, made by ../items/sbops_assemblies.py from the calc-set samples
// (public/models/assemblies/<subsystem>-<capacity>.json). Which one a node shows follows its name; a System node shows all of its subsystems'.
// Display finishes help distinguish nested parts in the schematic cutaway.
function partColor(name) {
  if (/2nd-pass/i.test(name)) return 0xb67d50;
  if (/3rd-pass/i.test(name)) return 0xd4a677;
  if (/stay|grate|fire bar|ladder|saddle|frame/i.test(name)) return 0x526478;
  if (/motor|pump|fan$/i.test(name)) return 0x427581;
  if (/valve|damper/i.test(name)) return 0x7d6350;
  if (/furnace|reversal|door/i.test(name)) return 0x657481;
  if (/pipe|gauge|chimney|cladding/i.test(name)) return 0xaab7c2;
  if (/shell|tube plate|panel/i.test(name)) return 0x70869a;
  return 0x879caf;
}
const SUBSYSTEMS = [['shell', /shell|body|pressure part/i], ['mountings', /mounting|fitting/i], ['feed', /feed/i],
  ['blowdown', /blow ?down/i], ['grate', /fire door|grate/i], ['duct', /flue|duct/i], ['idfan', /\bid fan|induced/i],
  ['chimney', /chimney|stack/i], ['fdfan', /\bfd fan|forced/i], ['panel', /electric|panel/i], ['insulation', /insulat|cladding/i]];
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
        const hit = re && p.match && !p.context && new RegExp(p.match, 'i').test(re);
        // Picked item: orange. The casing (shell, plates, furnace) turns to glass so parts inside stay visible; other
        // parts stay solid but pale, so the picked one stands out without the scene going to mush.
        const casing = /shell|tube plate|furnace|reversal/i.test(p.name);
        const glass = { transparent: true, opacity: p.context ? 0.07 : 0.12, depthWrite: false, color: 0xcfd8e3 };
        const mat = hit ? metal(THREE, { color: 0xf08a24, emissive: 0x7a3000 })
          : p.context || (re && casing) ? metal(THREE, glass)
            : re ? metal(THREE, { color: 0xdde3ea }) : metal(THREE, { color: partColor(p.name), flatShading: false });
        const o = meshObject(THREE, p.mesh, mat);
        o.children[0].rotation.x = 0; // assemblies are already Y-up
        if (p.context) o.userData.context = true;
        group.add(o);
        if (!p.context) { shown.push(p.name); if (hit) hits.push(p.name); }
      }
    }
    // Frame the subsystem's own parts; the faint shell around them is only for orientation.
    const bb = new THREE.Box3();
    for (const o of group.children) if (!o.userData.context) bb.expandByObject(o);
    group.position.sub(bb.getCenter(new THREE.Vector3()));
    const pivot = new THREE.Group(); pivot.add(group); pivot.rotation.y = -0.6; scene.add(pivot);
    // Fit actual vertices throughout a full turn. A sphere around the bounding
    // box wastes most of the frame on empty space alongside a tall stack.
    const center = bb.getCenter(new THREE.Vector3());
    const slopeY = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const slopeX = slopeY * w / h;
    const elevation = 0.35;
    const sin = Math.sin(elevation), cos = Math.cos(elevation);
    let distance = 1;
    for (const object of group.children) {
      if (object.userData.context) continue;
      const pos = object.children[0].geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const radius = Math.hypot(pos.getX(i) - center.x, pos.getZ(i) - center.z);
        const y = pos.getY(i) - center.y;
        const horizontal = y * sin + radius * Math.hypot(cos, 1 / slopeX);
        const upper = y * (sin + cos / slopeY) + radius * Math.abs(cos - sin / slopeY);
        const lower = y * (sin - cos / slopeY) + radius * (cos + sin / slopeY);
        distance = Math.max(distance, horizontal, upper, lower);
      }
    }
    distance *= 1.07;
    camera.near = distance / 100; camera.far = distance * 12; camera.updateProjectionMatrix();
    camera.position.set(0, distance * sin, distance * cos); camera.lookAt(0, 0, 0);
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
          {info ? `${keys.length > 1 ? `${keys.length} subsystems, ${info.parts.length} parts` : info.parts.join(', ')}. Sized from the ${info.capacity} kg/hr design template; nozzle and pipe positions are illustrative.` : 'Loading…'}
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
