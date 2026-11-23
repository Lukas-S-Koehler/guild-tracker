/** Safe in-site redirect target from ?next= (relative paths only, no protocol-relative URLs). */
export function nextParam(fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const n = new URLSearchParams(window.location.search).get('next');
  return n && n.startsWith('/') && !n.startsWith('//') ? n : fallback;
}

/** Carry ?next= over to a sibling auth page link. */
export function withNext(href: string): string {
  if (typeof window === 'undefined') return href;
  const n = new URLSearchParams(window.location.search).get('next');
  return n ? `${href}?next=${encodeURIComponent(n)}` : href;
}
