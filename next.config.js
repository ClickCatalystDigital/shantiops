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
const devPort = process.env.PORT && process.env.PORT !== '3000' ? process.env.PORT : null;

/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  ...(devPort ? { distDir: `.next-${devPort}` } : {}),
  // @react-pdf/renderer must run as a real Node module (fontkit/native deps), not be bundled.
  experimental: { serverComponentsExternalPackages: ['@react-pdf/renderer'] },
};
