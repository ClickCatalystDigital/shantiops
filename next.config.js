// ponytail: another Claude Code session runs `next dev` from this same working directory on the
// default port/build dir. Two `next dev` processes writing the same .next/ cache corrupts both
// (stale hot-update 404s, routes vanishing, ChunkLoadError). Give every dedicated-port dev server
// (.claude/launch.json) its own build dir — cheap, and doesn't touch the default/no-flag invocation
// (plain `next build`/`next dev`) at all.
//
// Must read `process.env.PORT`, not `-p`/`--port` out of argv: Next 14's CLI loads this file
// TWICE — once in the `next dev -p 3002` parent process (argv has `-p 3002`) and again inside the
// actual worker (`start-server.js`, spawned with NO port in its own argv — confirmed by logging
// both loads' argv here). The worker is the one that resolves `distDir` for real, so an argv sniff
// silently no-ops for the process that matters, even though it looks right in the parent. `PORT` is
// the one signal both loads agree on (Next sets it as an env var for the worker). Found the hard
// way (2026-08-11) after generalizing the original 3001-only sniff to cover a second dedicated
// port (3002): the old check also only ever worked by accident in whichever process order made its
// `argv.includes('3001')` true, not reliably — this replaces it outright.
const { TAB_BASES } = require('./lib/workspace-routes');
const WORKERS = process.env.SB_TARGET === 'workers';

const devPort = process.env.PORT && process.env.PORT !== '3000' ? process.env.PORT : null;

/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  ...(devPort ? { distDir: `.next-${devPort}` } : {}),
  // @react-pdf/renderer must run as a real Node module (fontkit/native deps), not be bundled.
  serverExternalPackages: ['@react-pdf/renderer'],
  // Next 15 loads every page/route (~600 here) into memory at start; that alone overflows Render's
  // 512 MB instance. Load each one on its first request instead, as Next 14 did.
  experimental: { preloadEntriesOnStart: false },
  // Commit this build came from (GET /api/version): Render sets RENDER_GIT_COMMIT, the GitHub deploy
  // workflow sets GITHUB_SHA. The deploy workflow waits until each server reports the pushed commit.
  env: { BUILD_COMMIT: process.env.RENDER_GIT_COMMIT || process.env.GITHUB_SHA || '' },
  // Cloudflare Workers build (npm run cf:build sets SB_TARGET=workers): libsql's web client instead
  // of the Node one, and its files traced in (Next's tracing only follows the Node entry).
  ...(WORKERS ? {
    outputFileTracingIncludes: { '/**': ['./node_modules/@libsql/**/*'] },
    webpack(config, { webpack }) {
      config.plugins.push(new webpack.NormalModuleReplacementPlugin(/[\\/]db-client\.js$/, (r) => { r.request = r.request.replace(/db-client\.js$/, 'db-client.workers.js'); }));
      return config;
    },
  } : {}),
  // /stores/inventory is served by the /stores page with tab=inventory. Real sub-pages such as
  // /accounts/documents win, because these rewrites only apply when no page matches.
  async rewrites() {
    return TAB_BASES.map(base => ({ source: `${base}/:tab`, destination: `${base}?tab=:tab` }));
  },
};
