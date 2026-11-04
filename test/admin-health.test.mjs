// Why something does or does not reach readers: each case here is a real way a briefing or a Signal group stayed invisible.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readFileSync } from 'node:fs';
import '../public/admin/health.js';

const { sourceCheck, groupStatus, briefingStatus, watchReach } = globalThis.Health;
const NOW = 1_800_000_000_000, when = (ms) => `t${ms}`;
const issue = (over = {}) => ({ id: '2026-11-04', status: 'published', created: NOW, tweets: 10, ...over });
const topic = (over = {}) => ({ slug: 'ai-academia', title: 'AI Academia', enabled: true, autoPublish: true, listed: true, lastRun: NOW, lastError: '', nextRun: NOW + 1, updated: NOW - 1, sources: [{ type: 'feed', source: 'arxiv' }], issues: [issue()], ...over });
const arxiv = { id: 'a1', label: 'arXiv: ai', source: 'arxiv', enabled: true, lastError: '' };

describe('a source of a briefing', () => {
  test('an empty X search says so', () => {
    const c = sourceCheck({ type: 'search', query: '  ' });
    assert.equal(c.level, 'bad'); assert.ok(c.empty);
    assert.equal(sourceCheck({ type: 'search', query: 'ai' }).level, 'ok');
  });
  test('a Live feed source with nothing to read names the kind of source', () => {
    const c = sourceCheck({ type: 'feed', source: 'arxiv' }, { watches: [{ id: 'y', label: 'Fireship', source: 'youtube', enabled: true }] });
    assert.equal(c.level, 'bad'); assert.match(c.text, /No arXiv source is watched/); assert.equal(c.fix.tab, 'sources');
  });
  test('paused and failing watches are told apart from working ones', () => {
    assert.match(sourceCheck({ type: 'feed', source: 'arxiv' }, { watches: [{ ...arxiv, enabled: false }] }).text, /paused/);
    assert.equal(sourceCheck({ type: 'feed', source: 'arxiv' }, { watches: [{ ...arxiv, lastError: 'HTTP 503' }] }).level, 'warn');
    const ok = sourceCheck({ type: 'feed', source: 'arxiv' }, { watches: [arxiv] });
    assert.equal(ok.level, 'ok'); assert.match(ok.text, /arXiv: ai/);
  });
  test('a watch a briefing hands over is not something a Live feed source reads', () => {
    assert.equal(sourceCheck({ type: 'feed' }, { watches: [{ id: 'brief:ai', label: 'Briefing', enabled: false, briefing: 'ai' }] }).level, 'bad');
  });
  test('data that has not loaded is not reported as a problem', () => {
    for (const s of [{ type: 'feed' }, { type: 'flist', listId: 'x' }, { type: 'list', listId: 'x' }, { type: 'xgroup', group: 'g' }]) assert.equal(sourceCheck(s).level, 'ok');
  });
  test('an empty or deleted list reads nothing', () => {
    assert.equal(sourceCheck({ type: 'flist', listId: 'x' }, { flists: [] }).level, 'bad');
    assert.equal(sourceCheck({ type: 'flist', listId: 'x' }, { flists: [{ id: 'x', name: 'L', members: [] }] }).level, 'bad');
    assert.equal(sourceCheck({ type: 'list', listId: 'x' }, { lists: [{ id: 'x', name: 'L', members: [{}] }] }).level, 'ok');
    assert.equal(sourceCheck({ type: 'xgroup', group: 'g' }, { xlists: [{ groups: ['other'] }] }).level, 'bad');
  });
});

describe('why a briefing is not showing', () => {
  test('a draft written before auto-publish was switched on: the case that started this', () => {
    const s = briefingStatus(topic({ updated: NOW + 5, issues: [issue({ status: 'draft' })] }), { when, watches: [arxiv] });
    assert.equal(s.label, 'Draft, not public'); assert.equal(s.next, 'publish'); assert.equal(s.draft.id, '2026-11-04');
    assert.match(s.headline, /Readers see nothing yet, because 2026-11-04 is still a draft/);
    assert.match(s.steps.find((x) => x.key === 'issue').text, /written before “Publish automatically” was on/);
    assert.equal(s.steps.find((x) => x.key === 'public').level, 'bad');
  });
  test('a new draft over an older published issue says what readers still see', () => {
    const s = briefingStatus(topic({ autoPublish: false, issues: [issue({ status: 'draft', id: 'new' }), issue({ id: 'old', created: NOW - 9 })] }), { when });
    assert.equal(s.label, 'New draft waiting'); assert.match(s.headline, /Readers still see old/);
  });
  test('sources that read nothing come before everything else, and send you to the settings', () => {
    const s = briefingStatus(topic({ issues: [] }), { when, watches: [] });
    assert.equal(s.label, 'Fix sources'); assert.equal(s.next, 'settings'); assert.match(s.headline, /No arXiv source is watched/);
  });
  test('a failed run offers to run again, and a run in progress offers nothing', () => {
    const failed = briefingStatus(topic({ lastError: 'model down' }), { when });
    assert.equal(failed.label, 'Run failed'); assert.equal(failed.next, 'run');
    const running = briefingStatus(topic({ lastError: 'model down' }), { when, busy: true });
    assert.equal(running.label, 'Running'); assert.equal(running.next, undefined);
  });
  test('sources with nothing new is not called a failure', () => {
    const s = briefingStatus(topic({ issues: [], lastError: 'no tweets matched in this period' }), { when, watches: [arxiv] });
    assert.equal(s.label, 'Nothing new'); assert.match(s.headline, /nothing from the past 24 hours/); assert.equal(s.steps.find((x) => x.key === 'run').level, 'warn');
  });
  test('never run, and link only', () => {
    assert.equal(briefingStatus(topic({ lastRun: 0, issues: [] }), { when }).label, 'Not run yet');
    assert.equal(briefingStatus(topic({ listed: false }), { when }).label, 'Link only');
  });
  test('a run that found nothing is a warning, not a success', () => {
    assert.equal(briefingStatus(topic({ issues: [issue({ tweets: 0 })] }), { when }).steps.find((x) => x.key === 'run').level, 'warn');
  });
  test('settings saved after the newest issue suggest a re-run, and a healthy briefing is simply live', () => {
    assert.ok(briefingStatus(topic({ updated: NOW + 5 }), { when }).stale);
    const s = briefingStatus(topic(), { when });
    assert.equal(s.label, 'Live'); assert.equal(s.level, 'ok'); assert.equal(s.stale, false); assert.equal(s.next, undefined);
  });
  test('shows whether its Signal group is public', () => {
    const signal = { days: 7, boards: [{ id: 'b', title: 'AI', public: true, groups: [] }], groups: [{ key: 'g', name: 'AI Academia', weight: 1, items: 3, watches: [{ id: 'brief:ai-academia' }] }] };
    const st = briefingStatus(topic({ toSignal: true }), { when, signal }).steps.find((x) => x.key === 'signal');
    assert.equal(st.level, 'warn'); assert.equal(st.addTo[0].id, 'b');
  });
});

describe('why a Signal group is not public', () => {
  const g = { key: 'g', name: 'Academia', weight: 1, items: 5 };
  test('counted but on no published Signal: the other case that started this', () => {
    const s = groupStatus(g, [{ id: 'b', title: 'AI', public: true, groups: ['other'] }]);
    assert.equal(s.level, 'warn'); assert.match(s.text, /not on a published Signal/); assert.deepEqual(s.addTo.map((b) => b.id), ['b']);
  });
  test('only on a draft Signal', () => {
    assert.match(groupStatus(g, [{ id: 'b', title: 'Draft one', public: false, groups: ['g'] }]).text, /Only on Draft one, which is not published/);
  });
  test('public, public but empty, and muted', () => {
    const boards = [{ id: 'b', title: 'AI', public: true, groups: ['g'] }];
    assert.equal(groupStatus(g, boards).level, 'ok');
    assert.match(groupStatus({ ...g, items: 0 }, boards, 3).text, /last 3 days/);
    assert.match(groupStatus({ ...g, weight: 0 }, boards).text, /Muted/);
  });
});

test('a watch says what it reaches', () => {
  const signal = { days: 7, boards: [], groups: [{ key: 'g', name: 'Academia', weight: 1, items: 1, watches: [{ id: 'a1' }] }] };
  const reach = watchReach(arxiv, { signal, when, topics: [topic({ issues: [issue({ status: 'draft' })] }), topic({ slug: 'yt', title: 'Video', sources: [{ type: 'feed', source: 'youtube' }] })] });
  assert.deepEqual(reach.map((r) => r.label), ['Signal group “Academia”', 'Briefing “AI Academia”']);
  assert.equal(reach[1].level, 'warn');
  assert.equal(watchReach({ ...arxiv, noSignal: true }, {})[0].label, 'Left out of Signal');
});

describe('the admin page', () => {
  const html = readFileSync(new URL('../public/admin/index.html', import.meta.url), 'utf8');
  test('styles the briefing screens wherever they are moved to', () => {
    // The layout moves between the Briefings and Settings sections, so a rule scoped to one of them does not reach the other.
    assert.doesNotMatch(html.slice(html.indexOf('Briefings (scheduled publishing)'), html.indexOf('/* ----- signal ----- */')), /#publish /);
  });
  test('loads this file by an address that also works at /admin without the slash', () => {
    assert.match(html, /<script src="\/admin\/health\.js"><\/script>/);
  });
});
