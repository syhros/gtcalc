/**
 * Vercel routing middleware: runs before static files, so a shared flow link (/?flow=<id>) can
 * get its own link-preview tags from api/flow.ts. Every other request carries on untouched.
 */
export const config = { matcher: '/' };

export default async function middleware(request: Request): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (!url.searchParams.has('flow')) return undefined; // the normal page
  try {
    const res = await fetch(new URL(`/api/flow${url.search}`, url.origin));
    // A fresh response: fetch has already decompressed the body, so passing its headers on
    // (Content-Encoding: br) would make browsers fail to read the page.
    if (res.ok) return new Response(await res.text(), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=0, s-maxage=300' } });
  } catch { /* fall through to the normal page */ }
  return undefined;
}
