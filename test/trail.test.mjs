// Trails (A4): reading `from=`, the topic before and after, the trail line, the small topic card, the keys script and the closing hints of get_topic.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { FROM_LIST, fromQuery, fromValue, lensFrom, neighbours, numbersLine, oneLine, parseFrom, trailJsonLd, trailParts, uniqueTopics, withFrom } from '../src/signal/trail.ts';
import { KEYS_JS } from '../src/site/keys.ts';
import { topicOut } from '../src/site/agentText.ts';

const list = ['a', 'b', 'c', 'd'].map((slug) => ({ slug, label: slug.toUpperCase() }));

describe('reading ?from=', () => {
  test('a lens, a search and a briefing are understood, with the lens window', () => {
    assert.deepEqual(parseFrom('lens:security'), { kind: 'lens', key: 'security', window: 1 });
    assert.deepEqual(parseFrom('lens:security@7'), { kind: 'lens', key: 'security', window: 7 });
    assert.deepEqual(parseFrom('lens:all'), { kind: 'lens', key: 'all', window: 1 });
    assert.deepEqual(parseFrom('search:mcp auth'), { kind: 'search', q: 'mcp auth' });
    assert.deepEqual(parseFrom('briefing:ai-today/2026-11-10'), { kind: 'briefing', slug: 'ai-today', id: '2026-11-10' });
    assert.deepEqual(parseFrom('briefing:ai-today/2026-11-10-2'), { kind: 'briefing', slug: 'ai-today', id: '2026-11-10-2' });
  });
  test('anything else is null, never a throw', () => {
    for (const bad of [null, undefined, '', 'lens', 'lens:', 'lens:Bad Key', 'lens:x@5', 'lens:../x', 'search:a', 'briefing:x', 'briefing:x/y', 'briefing:../x/2026-11-10', 'topic:abc', ':x', 'x'.repeat(200), 'lens:a\u0000b'])
      assert.equal(parseFrom(bad), null, String(bad));
  });
  test('what is written reads back the same, and is added before a #', () => {
    for (const f of [lensFrom('security', 3), lensFrom(undefined, 1), { kind: 'search', q: 'a b & c' }, { kind: 'briefing', slug: 'x', id: '2026-01-02' }]) assert.deepEqual(parseFrom(decodeURIComponent(fromQuery(f).slice(5))), f);
    assert.equal(fromValue(lensFrom('', 7)), 'lens:all@7');
    assert.equal(lensFrom('x', 14).window, 1);
    assert.equal(withFrom('/t/mcp', lensFrom('sec', 1)), '/t/mcp?from=lens:sec');
    assert.equal(withFrom('/t/mcp?area=politics#angle', lensFrom('sec', 3)), '/t/mcp?area=politics&from=lens:sec@3#angle');
    assert.equal(withFrom('/t/mcp', null), '/t/mcp');
    assert.match(withFrom('/t/mcp', { kind: 'search', q: 'a&b c' }), /\?from=search%3Aa%26b%20c$|\?from=search:a%26b%20c$/);
  });
});

describe('previous and next', () => {
  test('the topic before and after, and its place', () => {
    assert.deepEqual(neighbours(list, 'b'), { index: 2, total: 4, prev: list[0], next: list[2] });
    assert.deepEqual(neighbours(list, 'a'), { index: 1, total: 4, next: list[1] });
    assert.deepEqual(neighbours(list, 'd'), { index: 4, total: 4, prev: list[2] });
  });
  test('a topic that is not in the list, or a list of one, gives nothing', () => {
    assert.equal(neighbours(list, 'zzz'), null);
    assert.equal(neighbours([list[0]], 'a'), null);
    assert.equal(neighbours([], 'a'), null);
  });
  test('repeats are dropped in order, and the list is capped', () => {
    assert.deepEqual(uniqueTopics([...list, list[1], list[0]]).map((x) => x.slug), ['a', 'b', 'c', 'd']);
    assert.equal(uniqueTopics(Array.from({ length: 100 }, (_, i) => ({ slug: 's' + i }))).length, FROM_LIST);
  });
});

describe('the trail line', () => {
  const lenses = [{ key: 'security', name: 'Security' }];
  test('area, lens, topic and angle; the lens keeps its lens, the last part is the page', () => {
    const p = trailParts({ area: 'ai', from: lensFrom('security', 1), lenses, topic: { slug: 'mcp-auth-bypass', label: 'MCP auth bypass' }, angle: { key: 'papers', label: 'Papers' } });
    assert.deepEqual(p.map((x) => x.label), ['AI', 'Security', 'MCP auth bypass', 'Papers']);
    assert.equal(p[1].href, '/?lens=security');
    assert.equal(p[2].href, '/t/mcp-auth-bypass?from=lens:security');
    assert.equal(p[3].href, undefined);
    assert.deepEqual(p.map((x) => x.kind), ['area', 'lens', 'topic', 'angle']);
  });
  test('without an origin it is area, topic; on a card the item ends it and the topic stays a link', () => {
    const t = trailParts({ area: 'politics', topic: { slug: 'x', label: 'X' } });
    assert.deepEqual(t.map((x) => x.label), ['Politics', 'X']);
    assert.equal(t[0].href, '/politics'); assert.equal(t[1].href, undefined);
    const c = trailParts({ area: 'ai', topic: { slug: 'x', label: 'X' }, item: 'A very long title '.repeat(10) });
    assert.equal(c[1].href, '/t/x'); assert.equal(c[2].href, undefined); assert.ok(c[2].label.length <= 50);
  });
  test('a lens that is not known, or `all`, adds no lens part; search and briefing add theirs', () => {
    assert.equal(trailParts({ area: 'ai', from: lensFrom('nope', 1), lenses, topic: { slug: 'x', label: 'X' } }).length, 2);
    assert.equal(trailParts({ area: 'ai', from: lensFrom('all', 1), lenses, topic: { slug: 'x', label: 'X' } }).length, 2);
    const s = trailParts({ area: 'ai', from: { kind: 'search', q: 'mcp' }, topic: { slug: 'x', label: 'X' } });
    assert.equal(s[1].href, '/search?q=mcp'); assert.equal(s[2].href, undefined);
    const b = trailParts({ area: 'ai', from: { kind: 'briefing', slug: 'ai-today', id: '2026-11-10' }, briefingTitle: 'AI today', topic: { slug: 'x', label: 'X' } });
    assert.equal(b[1].label, 'AI today'); assert.equal(b[1].href, '/ai-today/2026-11-10');
  });
  test('the research pulse is a section', () => {
    const p = trailParts({ area: 'ai', section: [{ label: 'Research pulse', href: '/research' }, { label: 'Agents' }] });
    assert.deepEqual(p.map((x) => [x.label, x.href]), [['AI', '/'], ['Research pulse', '/research'], ['Agents', undefined]]);
  });
  test('the BreadcrumbList is valid JSON, absolute, and cannot close its script tag', () => {
    const j = trailJsonLd(trailParts({ area: 'ai', topic: { slug: 'x', label: '</script><b>' } }), 'https://u.example');
    assert.ok(!j.includes('</script>'));
    const d = JSON.parse(j);
    assert.equal(d['@type'], 'BreadcrumbList');
    assert.equal(d.itemListElement[0].item, 'https://u.example/'); assert.equal(d.itemListElement[1].item, undefined); assert.equal(d.itemListElement[1].position, 2);
  });
});

describe('the small topic card', () => {
  test('the first sentence of a summary, or the whole when short; cut when long', () => {
    assert.equal(oneLine('MCP servers skipped checks on the token. A fix is out. More later.'), 'MCP servers skipped checks on the token.');
    assert.equal(oneLine('Short.'), 'Short.');
    assert.ok(oneLine('word '.repeat(80)).length <= 150);
    assert.equal(oneLine(''), '');
  });
  test('a line from the numbers alone', () => {
    assert.equal(numbersLine('Foo', 'rising', [1, 2, 3, 4]), 'Foo is rising: 10 mentions in the last 4 days.');
    assert.equal(numbersLine('Foo', null, [1]), 'Foo is being talked about: 1 mention in the last 1 days.');
  });
});

describe('the keys script', () => {
  test('is valid script, ignores typing and modifier keys, and lists its keys', () => {
    assert.doesNotThrow(() => new Function(KEYS_JS));
    assert.ok(KEYS_JS.length < 6000);
    for (const must of ["e.ctrlKey||e.metaKey||e.altKey", "typing(e.target)", "'TEXTAREA'", 'isContentEditable', "rel=", 'Keyboard shortcuts', '/t/', "role','tooltip'"]) assert.ok(KEYS_JS.includes(must), must);
    assert.ok(!/eval\(|document\.write|innerHTML\s*=\s*[a-z]*location/.test(KEYS_JS));
  });
});

describe('get_topic closes with the neighbours', () => {
  const t = { slug: 'b', term: 'b', label: 'B', members: [], board: { slug: 's', title: 'S', proof: true }, area: 'ai', alsoIn: [], days: 7, from: '2026-11-04', to: '2026-11-11', baselineOk: true, state: 'rising', signal: 0.1, change: 2, isNew: false, kind: 'shared', breadth: 2, active: 3, reactions: 0,
    series: { days: ['2026-11-10', '2026-11-11'], counts: [1, 2], usual: 0 }, counts: {}, total: 3, evidence: [], summary: null, fallback: 'B is rising.', talk: [], papers: { matched: 0, mentioned: 0, list: [] }, first: { arrivals: [], onset: null, openEnded: false, thin: false, mentions: 0 }, timeline: [], watch: [],
    related: [{ slug: 'r1', label: 'R1', state: 'new', line: 'R1 is new.' }] };
  const from = { kind: 'lens', key: 'security', window: 1 };
  test('names the next topic of the list with the same from, and a related one', () => {
    const a = topicOut(t, 'https://u.example', 'brief', 7, { from, list });
    assert.match(a.text, /\*\*Next:\*\*.*`topic: "c"`.* and `from: "lens:security"`.*\(2 of 4: C\)/);
    assert.match(a.text, /`topic: "a"`/);
    assert.match(a.text, /`topic: "r1"`.*neighbour/);
    assert.match(a.text, /R1.*\(new\): R1 is new\./);
    assert.deepEqual(a.data.list, { from: 'lens:security', position: 2, total: 4, previous: list[0], next: list[2] });
  });
  test('without a list, or when the topic is not in it, there is just the usual hints', () => {
    assert.equal(topicOut(t, 'https://u.example').data.list, null);
    assert.equal(topicOut(t, 'https://u.example', 'brief', 7, { from, list: [list[0], list[2]] }).data.list, null);
    assert.doesNotMatch(topicOut(t, 'https://u.example').text, /from: "/);
  });
});
