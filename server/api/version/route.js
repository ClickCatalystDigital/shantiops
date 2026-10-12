// Public: which commit this server is running (the deploy workflow checks it after each deploy).
export function GET() {
  return Response.json({ commit: process.env.BUILD_COMMIT || null });
}
