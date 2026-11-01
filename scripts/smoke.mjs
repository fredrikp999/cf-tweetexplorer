// Smoke test for a deployed site: fetches every kind of public page and checks it answers and looks right.
// Usage: node scripts/smoke.mjs https://example.com   (or SMOKE_URL=https://example.com npm run smoke)
// It follows the site's own links (the topics on Today, the first Signal and one of its topics), so it needs no list of pages.
// Exits 1 when a check fails. It only reads: nothing is posted, so it is safe to run against the live site.

const base = (process.argv[2] || process.env.SMOKE_URL || '').replace(/\/+$/, '');
if (!/^https?:\/\//.test(base)) { console.error('Give the site: node scripts/smoke.mjs https://example.com'); process.exit(2); }

const results = [];
async function check(path, { status = 200, has = [], type, note } = {}) {
  const t0 = Date.now();
  let res, body = '', err = '';
  try {
    res = await fetch(base + path, { redirect: 'manual', headers: { 'user-agent': 'agent-cortex-smoke/1' }, signal: AbortSignal.timeout(20_000) });
    body = await res.text();
  } catch (e) { err = e.message; }
  const ms = Date.now() - t0, problems = [];
  if (err) problems.push(err);
  else {
    const want = Array.isArray(status) ? status : [status];
    if (!want.includes(res.status)) problems.push(`status ${res.status}, wanted ${want.join(' or ')}`);
    if (type && !(res.headers.get('content-type') || '').includes(type)) problems.push(`content-type ${res.headers.get('content-type')}`);
    for (const h of has) if (!body.includes(h)) problems.push(`missing ${JSON.stringify(h)}`);
    if (res.status === 200 && (res.headers.get('content-type') || '').includes('text/html') && !res.headers.get('content-security-policy')) problems.push('no content-security-policy');
  }
  results.push({ path, ok: !problems.length, ms, problems, note });
  return body;
}
const first = (html, re) => re.exec(html)?.[1];

// Today and the topics it lists.
const today = await check('/', { has: ['Agent Cortex', '<h1>Today</h1>'] });
const topics = [...new Set([...today.matchAll(/<ul class="today">[\s\S]*?<\/ul>/g)].flatMap((m) => [...m[0].matchAll(/href="\/([a-z0-9-]+)"/g)].map((x) => x[1])))].slice(0, 4);
if (!topics.length) results.push({ path: '/', ok: false, ms: 0, problems: ['no topics on Today'] });
for (const slug of topics) {
  const page = await check(`/${slug}`, { has: ['class="views"', '<article', 'href="/' + slug + '/feed.xml"'] });
  const issue = first(page, new RegExp(`rel="canonical" href="[^"]*/${slug}/([0-9-]+)"`));
  await check(`/${slug}/archive`, { has: ['class="views"'] });
  await check(`/${slug}/feed.xml`, { type: 'rss', has: ['<rss', '<item>'] });
  if (issue) {
    await check(`/${slug}/${issue}`, { has: ['<article'] });
    await check(`/report/${slug}/${issue}`, { has: ['<form class="report"', 'name="message"'] });
  }
}

// Signal: the index, the first published Signal, one of its topics, and how it works.
const sigIndex = await check('/signal', { status: [200, 404], note: '404 when no Signal is published' });
const board = first(sigIndex, /href="\/signal\/(?!method)([a-z0-9-]+)"/);
if (board) {
  const sig = await check(`/signal/${board}`, { has: ['What is in the signal', 'aria-label="Sort"'] });
  const term = first(sig, new RegExp(`href="/signal/${board}/t/([^"/?]+)"`));
  if (term) await check(`/signal/${board}/t/${term}`, { has: ['Day by day', 'Where it shows up'] });
  await check(`/signal/${board}?sort=rising`, { has: ['aria-current="page">Rising'] });
}
await check('/signal/method', { has: ['How Signal works'] });

// Feed pages: the first one listed in the menu.
const feed = first(today, /href="\/feeds\/([a-z0-9-]+)"/);
if (feed) await check(`/feeds/${feed}`, { has: ['<h1>', 'Titles, pictures and videos belong to their publishers'] });

// The rest, and what must not be served.
await check('/history', { status: [200, 404] });
await check('/lists', { status: [200, 404] });
await check('/robots.txt', { type: 'text/plain', has: ['Disallow: /admin'] });
await check('/no-such-page-at-all', { status: 404 });
await check('/admin/', { status: [302, 401, 403], note: 'must not open without Cloudflare Access' });
await check('/signal/overview', { status: [301, 404], note: 'an old Signal address redirects (404 if it never existed)' });

// Report.
const width = Math.max(...results.map((r) => r.path.length));
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.path.padEnd(width)} ${String(r.ms).padStart(5)} ms${r.ms > 3000 ? ' (slow)' : ''}${r.problems.length ? '  ' + r.problems.join('; ') : ''}${r.note && !r.ok ? `  (${r.note})` : ''}`);
}
console.log(`\n${results.length - failed} of ${results.length} checks passed against ${base}`);
process.exit(failed ? 1 : 0);
