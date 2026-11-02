import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import { GALAXY_PAGE_SQL, MAX_GALAXY_POINTS, galaxyMeta, galaxyPoint, publicAnalysis, publicGalaxyMeta, publicGalaxyPoint } from '../src/history/galaxy.ts';
import html from '../src/apps/galaxy.ts';

const row = (over = {}) => ({ id: '1', json: JSON.stringify({ createdAt: 'Wed Oct 01 12:00:00 +0000 2026', likeCount: 5, text: 'a &gt; b https://t.co/x  c', author: { userName: 'ann' } }), theme: 1, kind: 2, stance: '+.', ...over });

describe('galaxy points', () => {
  test('makes one compact row, with the text cleaned for display', () => {
    assert.deepEqual(galaxyPoint(row(), 3), ['1', Date.parse('2026-10-01T12:00:00Z') / 1000, 5, 1, 2, '+.', 'ann', 'a > b c']);
  });
  test('a tweet still waiting for a label counts as not labelled, whichever waiting state it is in', () => {
    for (const theme of [null, -2, -5]) { const p = galaxyPoint(row({ theme, kind: null, stance: null }), 3); assert.equal(p[3], -1); assert.equal(p[4], 7); assert.equal(p[5], ''); }
  });
  test('a theme past the end falls into Other, and a bad date or long text does not break the row', () => {
    const p = galaxyPoint(row({ theme: 9, json: JSON.stringify({ createdAt: 'nonsense', text: 'x'.repeat(400) }) }), 3);
    assert.equal(p[3], 3); assert.equal(p[1], 0); assert.equal(p[2], 0); assert.equal(p[6], ''); assert.equal(p[7].length, 280);
  });
  test('the page query orders by likes, keeps tweets with no label, and stays inside one job', () => {
    const db = new DatabaseSync(':memory:');
    db.exec("CREATE TABLE tweets (job TEXT, id TEXT, json TEXT); CREATE TABLE labels (job TEXT, id TEXT, theme INT, kind INT, stance TEXT);");
    const add = db.prepare('INSERT INTO tweets VALUES (?, ?, ?)');
    add.run('a', 'low', '{"likeCount":1}'); add.run('a', 'high', '{"likeCount":90}'); add.run('a', 'none', '{}'); add.run('b', 'other', '{"likeCount":999}');
    db.prepare('INSERT INTO labels VALUES (?, ?, ?, ?, ?)').run('a', 'high', 2, 1, '+');
    const q = db.prepare(GALAXY_PAGE_SQL);
    const rows = q.all('a', 10, 0);
    assert.deepEqual(rows.map((r) => r.id), ['high', 'low', 'none']);
    assert.equal(rows[0].theme, 2); assert.equal(rows[1].theme, null);
    assert.deepEqual(q.all('a', 1, 1).map((r) => r.id), ['low']);
  });
});

describe('galaxy summary', () => {
  const job = { id: 'j', query: 'q'.repeat(90), tweets: MAX_GALAXY_POINTS + 5, fromTs: 1, toTs: 2 };
  test('caps what is shown and names Other as the last theme', () => {
    const results = { themes: [{ count: 3, likes: 9, top: [] }, { count: 1, likes: 0, top: [] }], subjects: [{ for: 1, against: 2, neutral: 0, none: 1 }] };
    const m = galaxyMeta(job, { config: { themes: [{ name: 'A', description: 'a' }], subjects: [{ name: 'S', description: '' }] }, results }, []);
    assert.equal(m.shown, MAX_GALAXY_POINTS); assert.equal(m.analysed, true); assert.equal(m.title.length, 60);
    assert.deepEqual(m.themes.map((t) => [t.name, t.count]), [['A', 3], ['Other', 1]]);
    assert.equal(m.subjects[0].against, 2);
  });
  test('a collection with no finished analysis has no themes or subjects', () => {
    const m = galaxyMeta(job, { config: { themes: [{ name: 'A', description: '' }], subjects: [] } }, []);
    assert.equal(m.analysed, false); assert.deepEqual(m.themes, []); assert.deepEqual(m.subjects, []);
  });
});

describe('galaxy on the public site', () => {
  const config = { themes: [{ name: 'Private theme', description: '' }], subjects: [{ name: 'Private subject', description: '' }] };
  const results = { themes: [{ count: 1, likes: 0, top: [] }], subjects: [{ for: 1, against: 0, neutral: 0, none: 0 }] };
  test('uses an analysis only when it was published and is finished', () => {
    const done = { config, results, public: true, status: 'done' };
    assert.equal(publicAnalysis(done), done);
    for (const a of [{ ...done, public: false }, { ...done, status: 'running' }, { config, public: true, status: 'done' }, null, undefined]) assert.equal(publicAnalysis(a), null);
  });
  test('a private analysis leaves no trace in a row', () => {
    const p = publicGalaxyPoint(row(), null);
    assert.equal(p[3], -1); assert.equal(p[4], 7); assert.equal(p[5], '');
    assert.equal(p[7], 'a > b c');
  });
  test('a public analysis keeps the labels', () => {
    const p = publicGalaxyPoint(row(), { config: { themes: [{}, {}, {}] }, results, public: true, status: 'done' });
    assert.equal(p[3], 1); assert.equal(p[5], '+.');
  });
  test('the summary names the report, not the job, and no other collection', () => {
    const job = { id: 'internal-job-id', query: 'q', tweets: 3, fromTs: 1, toTs: 2, report: { title: 'T' } };
    const m = publicGalaxyMeta(job, 'my-report', null), out = JSON.stringify(m);
    assert.equal(m.id, 'my-report'); assert.deepEqual(m.jobs, []); assert.ok(!out.includes('internal-job-id'));
    assert.deepEqual(m.themes, []); assert.deepEqual(m.subjects, []); assert.equal(m.analysed, false);
  });
});

describe('galaxy page', () => {
  const script = /<script>([\s\S]*)<\/script>/.exec(html)[1];
  test('is one classic inline script that parses, with no loaded files', () => {
    new vm.Script(script);
    assert.equal((html.match(/<script/g) ?? []).length, 1);
    assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=|import\s*\(/);
  });
});
