/**
 * Only same-site paths may be used as a post-login destination. "//evil.com"
 * and "/\evil.com" are protocol-relative to browsers and would leave the site.
 */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
