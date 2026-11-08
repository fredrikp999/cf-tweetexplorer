// Hosts the site has moved away from: a request to one is sent, path and query unchanged, to the host it moved to. The map is the MOVED_HOSTS secret
// ("old.example.com=new.example.com", several separated by commas or spaces), not the repo, which names no domains. Pure, so Node can test it.

/** "a=b, c=d" as a map old host -> new host, lowercase; entries that are not two host names, or point at themselves, are left out. */
export function parseMovedHosts(raw: string | undefined): Map<string, string> {
  const out = new Map<string, string>(), host = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
  for (const pair of String(raw ?? '').toLowerCase().split(/[\s,]+/)) {
    const [from, to] = pair.split('=');
    if (from && to && from !== to && host.test(from) && host.test(to)) out.set(from, to);
  }
  return out;
}

/** Where a request to a moved host goes instead, or null when its host has not moved. 308 keeps the method and body, so MCP clients that post follow it too. */
export function movedResponse(url: URL, moved: Map<string, string>): Response | null {
  const to = moved.get(url.hostname.toLowerCase());
  if (!to) return null;
  return new Response(null, { status: 308, headers: { location: `https://${to}${url.pathname}${url.search}`, 'cache-control': 'public, max-age=3600' } });
}
