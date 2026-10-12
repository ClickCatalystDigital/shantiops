// Route table -> segment tree, and URL path -> { key, params }. Pure, no Next imports (selfcheck:
// `node lib/api-match.mjs`). Used by app/api/[...path]/route.js to serve the handlers in server/api/.
// Precedence follows Next: at each level a fixed segment is tried before a [param], with backtracking
// if that branch dead-ends deeper down. Lookup cost grows with path depth, not with the route count.

// keys: route paths as written on disk, e.g. 'stock-pieces/[id]/cut'.
export function buildTree(keys) {
  const root = { fixed: new Map(), param: null, key: null };
  for (const key of keys) {
    let node = root;
    for (const seg of key.split('/')) {
      const m = seg.match(/^\[([A-Za-z0-9_]+)\]$/);
      if (m) {
        if (!node.param) node.param = { name: m[1], node: { fixed: new Map(), param: null, key: null } };
        else if (node.param.name !== m[1]) throw new Error(`api routes: [${node.param.name}] and [${m[1]}] at the same level (${key})`);
        node = node.param.node;
      } else {
        if (!node.fixed.has(seg)) node.fixed.set(seg, { fixed: new Map(), param: null, key: null });
        node = node.fixed.get(seg);
      }
    }
    if (node.key) throw new Error(`api routes: duplicate route ${key}`);
    node.key = key;
  }
  return root;
}

// segments: decoded URL segments after /api/. Returns { key, params } or null.
export function matchRoute(tree, segments) {
  const params = {};
  function walk(node, i) {
    if (i === segments.length) return node.key;
    const fixed = node.fixed.get(segments[i]);
    if (fixed) { const k = walk(fixed, i + 1); if (k) return k; }
    if (node.param && segments[i] !== '') {
      params[node.param.name] = segments[i];
      const k = walk(node.param.node, i + 1);
      if (k) return k;
      delete params[node.param.name];
    }
    return null;
  }
  const key = walk(tree, 0);
  return key ? { key, params } : null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const assert = (await import('node:assert')).strict;
  const t = buildTree(['stock-pieces', 'stock-pieces/savings', 'stock-pieces/[id]', 'stock-pieces/[id]/cut',
    'a/[id]/x', 'a/b/y', 'material-indents/[id]/items/[itemId]/release']);
  assert.deepEqual(matchRoute(t, ['stock-pieces']), { key: 'stock-pieces', params: {} });
  assert.deepEqual(matchRoute(t, ['stock-pieces', 'savings']), { key: 'stock-pieces/savings', params: {} });
  assert.deepEqual(matchRoute(t, ['stock-pieces', '7']), { key: 'stock-pieces/[id]', params: { id: '7' } });
  assert.deepEqual(matchRoute(t, ['stock-pieces', '7', 'cut']), { key: 'stock-pieces/[id]/cut', params: { id: '7' } });
  // fixed 'b' exists but has no 'x' below it: back up and take [id]
  assert.deepEqual(matchRoute(t, ['a', 'b', 'x']), { key: 'a/[id]/x', params: { id: 'b' } });
  assert.deepEqual(matchRoute(t, ['a', 'b', 'y']), { key: 'a/b/y', params: {} });
  assert.deepEqual(matchRoute(t, ['material-indents', '3', 'items', '9', 'release']),
    { key: 'material-indents/[id]/items/[itemId]/release', params: { id: '3', itemId: '9' } });
  assert.equal(matchRoute(t, ['stock-pieces', '7', 'nope']), null);
  assert.equal(matchRoute(t, ['nope']), null);
  assert.equal(matchRoute(t, ['stock-pieces', '']), null);
  assert.throws(() => buildTree(['x/[a]', 'x/[b]/y']));
  assert.throws(() => buildTree(['x', 'x']));
  console.log('api-match ok');
}
