// app/.well-known/security.txt/route.ts — RFC 9116 security.txt.
//
// Security researchers and automated scanners look for this file to find the
// right disclosure contact. The human-readable /security page links here.
// `Expires` is computed ~1 year out at request time so the file never goes
// stale (RFC 9116 requires a future Expires).

export const dynamic = "force-dynamic";

export function GET(): Response {
  const expires = new Date();
  expires.setUTCFullYear(expires.getUTCFullYear() + 1);
  const body = [
    "Contact: mailto:support@pdfcraftai.com",
    `Expires: ${expires.toISOString()}`,
    "Preferred-Languages: en",
    "Canonical: https://pdfcraftai.com/.well-known/security.txt",
    "Policy: https://pdfcraftai.com/security",
    "",
  ].join("\n");
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=86400",
    },
  });
}
