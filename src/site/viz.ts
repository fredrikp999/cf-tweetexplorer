// The public pages that run a script: the Tweet Galaxy of a published report, Who Said It First of a published Signal, the Research map, and the Landscape on the landing page. Every other public page stays script-free.
// They show the same views as the MCP Apps (src/apps/), unchanged. /viz/host.js plays the part the Claude app plays there: it puts the view in a sandboxed frame and answers its
// ui/* messages, reading this site's public JSON instead of calling tools. The frame has no network, no storage and no way to touch the page, and its one script is pinned by hash.
import firstHtml from '../apps/first.ts';
import galaxyHtml from '../apps/galaxy.ts';
import landscapeHtml from '../apps/landscape.ts';
import mapHtml from '../apps/map.ts';

export const VIZ_VIEWS: Record<string, string> = { 'galaxy.html': galaxyHtml, 'first.html': firstHtml, 'map.html': mapHtml, 'landscape.html': landscapeHtml };
export const VIZ_CSS = '.vizlink{display:flex;flex-direction:column;gap:2px;max-width:40rem;margin:14px 0 22px;padding:12px 16px;border:1px solid var(--accent);border-radius:12px;background:var(--card);color:var(--text);text-decoration:none}.vizlink:hover{background:var(--line)}.vizlink b{font-size:15.5px}.vizlink span{color:var(--muted);font-size:13.5px}.topics li.pic{flex-direction:column;gap:6px}.topics li.pic a.card{flex:1}.cardpic{padding:2px 4px;font-size:13.5px;color:var(--muted)}.cardpic:hover{color:var(--text)}.chips a[aria-current=page]{border-color:var(--accent);font-weight:600}.vizbox{margin:14px 0;border-radius:10px;overflow:hidden;background:#07090f;min-height:320px}.vizbox iframe{display:block;width:100%;height:560px;border:0;background:#07090f}.vizbox iframe.full{position:fixed;inset:0;width:100vw;height:100vh!important;z-index:50}.vizbox noscript p{margin:0;padding:18px;color:#eef0f5}.vizbox.land{background:none;min-height:0;border:1px solid var(--line);border-radius:12px;margin:6px 0 12px}.vizbox.land iframe{background:none;height:340px}.vizbox.land noscript{display:none}@media(max-width:520px){.vizbox.land{display:none}}';

/** The policy of a view's frame: only its own script runs, and it cannot reach anything. */
export async function viewCsp(html: string): Promise<string> {
  const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1] ?? '';
  const hash = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(script)))));
  return `default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-scripts`;
}

/** The frame on a page. `base` is where its JSON is read from; the addresses come from this site's own slugs, which are checked before a page is drawn. It has no address here: the host script gives it one once it is listening, because a view says hello only once. */
export const vizFrame = (view: 'galaxy' | 'first' | 'map' | 'landscape', base: string, title: string, /** A lens key the view starts with (the Research map). The caller has checked it. */ lens = ''): string =>
  `<div class="vizbox${view === 'landscape' ? ' land' : ''}"><iframe id="viz" data-kind="${view}" data-base="${base}"${lens ? ` data-lens="${lens}"` : ''} sandbox="allow-scripts" title="${title}"></iframe><noscript><p>This picture needs JavaScript. Everything else on this site works without it.</p></noscript></div><script src="/viz/host.js" defer></script>`;

/** Asks the public JSON what a view would ask a tool. Plain script, served as a file, because the site's policy allows no inline script. */
export const HOST_JS = `(function () {
  var f = document.getElementById('viz'), kind = f.dataset.kind, base = f.dataset.base;
  var to = function (m) { m.jsonrpc = '2.0'; f.contentWindow.postMessage(m, '*'); };
  var read = function (path, done) {
    fetch(path).then(function (r) { return r.text().then(function (t) { done({ content: [{ type: 'text', text: r.ok ? t : 'This could not be read.' }], isError: !r.ok }); }); })
      .catch(function () { done({ content: [{ type: 'text', text: 'This could not be read.' }], isError: true }); });
  };
  var first = function () { return kind === 'first' ? base + '/14.json' : kind === 'landscape' ? base : base + '.json' + (kind === 'map' && /^[a-z][a-z0-9-]{1,19}$/.test(f.dataset.lens || '') ? '?lens=' + f.dataset.lens : ''); };
  var pathOf = function (name, a) {
    a = a || {};
    if (kind === 'galaxy' && name === 'get_galaxy_points' && Number.isInteger(a.offset) && a.offset >= 0) return base + '/' + a.offset + '.json';
    if (kind === 'first' && name === 'get_who_said_first' && (a.days === 7 || a.days === 14)) return base + '/' + a.days + '.json';
    if (kind === 'map' && name === 'get_paper' && /^\\d{4}\\.\\d{4,5}$/.test(String(a.id))) return base + '/paper/' + a.id + '.json';
    if (kind === 'landscape' && name === 'get_overview' && [1, 3, 7].indexOf(a.window === undefined ? 1 : a.window) >= 0 && (a.lens === undefined || /^[a-z][a-z0-9-]{1,19}$/.test(String(a.lens)))) return '/overview.json?window=' + (a.window === undefined ? 1 : a.window) + (a.lens ? '&lens=' + a.lens : '') + (a.area === 'politics' ? '&area=politics' : '');
    return '';
  };
  // The picture follows the page's theme (light, dark or automatic), as a host's light and dark would.
  // On the landing page the picture sits in the dark masthead, so it is always dark there.
  var themeNow = function () { if (f.closest && f.closest('.mast')) return 'dark'; var t = document.documentElement && document.documentElement.getAttribute('data-theme'); return t === 'light' || t === 'dark' ? t : window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; };
  window.addEventListener('message', function (e) {
    if (e.source !== f.contentWindow || !e.data) return;
    var m = e.data, p = m.params || {}, ok = function (r) { to({ id: m.id, result: r }); }, no = function (text) { to({ id: m.id, error: { code: -32601, message: text } }); };
    if (m.method === 'ui/initialize') { var theme = ''; try { theme = themeNow(); } catch (x) {} var inMast = !!(f.closest && f.closest('.mast')); ok({ hostContext: { availableDisplayModes: inMast ? ['inline'] : ['inline', 'fullscreen'], displayMode: 'inline', theme: theme || undefined, embed: inMast ? 'hero' : undefined }, hostCapabilities: { openLinks: {} } }); }
    else if (m.method === 'ui/notifications/initialized') read(first(), function (r) { to({ method: 'ui/notifications/tool-result', params: r }); });
    else if (m.method === 'ui/notifications/size-changed') { if (!f.classList.contains('full') && p.height > 0) f.style.height = Math.ceil(p.height) + 'px'; }
    else if (m.method === 'tools/call') { var path = pathOf(p.name, p.arguments); if (path) read(path, ok); else no('not available here'); }
    else if (m.method === 'ui/open-link') { if (/^https:\\/\\//.test(String(p.url))) { window.open(String(p.url), '_blank', 'noopener,noreferrer'); ok({}); } else no('only https links open'); }
    else if (m.method === 'ui/request-display-mode') { f.classList.toggle('full', p.mode === 'fullscreen'); ok({ mode: f.classList.contains('full') ? 'fullscreen' : 'inline' }); }
    else if (kind === 'landscape' && (m.method === 'ui/message' || m.method === 'ui/update-model-context')) ok({});   // nobody to tell on a web page: answered, and ignored (the other views want the refusal)
    else if (m.id) no('not available here');
  });
  try { if (window.MutationObserver) new MutationObserver(function () { to({ method: 'ui/notifications/host-context-changed', params: { theme: themeNow() } }); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); } catch (x) {}
  var load = function () { f.src = '/viz/' + kind + '.html'; };
  // The landscape comes after the text: when the page has finished loading, and not at all on a phone, where the ranked list is the picture.
  if (kind === 'landscape') {
    if (window.matchMedia && window.matchMedia('(max-width: 520px)').matches) return;
    if (document.readyState !== 'complete') { window.addEventListener('load', load); return; }
  }
  load();
})();
`;
