// Themes around the pure module (src/signal/themeview.ts): stories for themes.ts, proposal keys and holding back, the admin's source lists, curves and marks.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { followOfTheme, heldBack, noisySources, proposalKey, storyMarks, themeOfFollow, themeStoriesOf, thinThemes, weekly, weeksSince } from '../src/signal/themeview.ts';

const NOW = Date.parse('2026-11-13T12:00:00Z'), DAY = 86_400_000;

describe('themeStoriesOf', () => {
  test('daily counts per group go with their story', () => {
    const s = themeStoriesOf([{ id: 'a', name: 'x', centre: [1, 0], first: 1, last: 2, n: 3, theme: null }], [{ story: 'a', day: '2026-11-10', grp: 'g1', n: 2 }, { story: 'a', day: '2026-11-10', grp: 'g2', n: 1 }, { story: 'b', day: '2026-11-10', grp: 'g1', n: 9 }]);
    assert.deepEqual(s[0].days, { '2026-11-10': { g1: 2, g2: 1 } });
  });
});

describe('proposals', () => {
  test('keys by kind', () => {
    assert.equal(proposalKey({ kind: 'candidate', key: 'k1' }), 'c:k1');
    assert.equal(proposalKey({ kind: 'merge', themes: ['b', 'a'], sim: 0.9 }), 'merge:a|b');
    assert.equal(proposalKey({ kind: 'retire', theme: 't1', quietWeeks: 7 }), 'retire:t1');
  });
  test('held back by the same key, or a candidate with an alike centre', () => {
    const bg = [0, 0, 0];
    assert.equal(heldBack({ key: 'retire:t1' }, [{ key: 'retire:t1' }], bg), true);
    assert.equal(heldBack({ key: 'c:new', centre: [1, 0.05, 0] }, [{ key: 'c:old', centre: [1, 0, 0] }], bg), true);
    assert.equal(heldBack({ key: 'c:new', centre: [0, 1, 0] }, [{ key: 'c:old', centre: [1, 0, 0] }], bg), false);
    assert.equal(heldBack({ key: 'split:t1' }, [{ key: 'c:old', centre: [1, 0, 0] }], bg), false);
  });
});

describe('the lists of section 6b', () => {
  test('thin themes and noisy sources', () => {
    assert.deepEqual(thinThemes(new Map([['t1', new Set(['a'])], ['t2', new Set(['a', 'b', 'c'])], ['t3', new Set(['a', 'b'])]])), [{ theme: 't1', sources: 1 }, { theme: 't3', sources: 2 }]);
    const r = noisySources(new Map([['w1', 50], ['w2', 50], ['w3', 5]]), new Map([['w1', 2], ['w2', 30]]));
    assert.deepEqual(r.map((x) => x.watch), ['w1']);
  });
});

describe('time and marks', () => {
  test('weeks of history and a weekly curve', () => {
    assert.equal(weeksSince('2026-10-30', NOW), 3);
    assert.equal(weeksSince(null, NOW), 1);
    assert.deepEqual(weekly([{ day: '2026-11-13', n: 2 }, { day: '2026-11-05', n: 3 }, { day: '2025-01-01', n: 9 }], 3, NOW), [0, 3, 2]);
  });
  test('new in a theme, uncharted', () => {
    assert.deepEqual(storyMarks({ theme: 't', bornNew: true, first: NOW - DAY }, NOW, true), { newIn: true, uncharted: false });
    assert.deepEqual(storyMarks({ theme: null, bornNew: true, first: NOW - DAY }, NOW, true), { newIn: false, uncharted: true });
    assert.deepEqual(storyMarks({ theme: null, bornNew: true, first: NOW - DAY }, NOW, false), { newIn: false, uncharted: false });
  });
  test('a followed theme is told from a topic', () => {
    assert.equal(themeOfFollow(followOfTheme('agent-security')), 'agent-security');
    assert.equal(themeOfFollow('agent-security'), null);
  });
});

describe('get_theme text', async () => {
  const { themeOut, themeMissing } = await import('../src/site/agentText.ts');
  const t = { slug: 'agent-security-incidents', area: 'ai', name: 'Agent security incidents', sentence: 'Breaches and flaws in AI agents.', inside: 'attacks on agents', outside: 'model jailbreaks', notConfused: 'Model safety',
    state: 'active', created: NOW - 30 * DAY, lens: { key: 'security', name: 'Security', color: 'red' }, weeks: 4, curve: [1, 2, 3, 4], to: '2026-11-13', groups: [{ name: 'X', n: 5 }],
    stories: [{ slug: 'claude-code-backdoor', name: 'claude code backdoor', first: NOW - 2 * DAY, last: NOW, n: 9, isNew: true, state: 'live', newIn: true }], newStories: [], others: [] };
  test('names the theme, its stories with addresses, and the next step', () => {
    const a = themeOut({ ...t, newStories: t.stories }, 'https://x.test');
    assert.match(a.text, /Agent security incidents/); assert.match(a.text, /New in it this week/); assert.match(a.text, /`claude-code-backdoor`/); assert.match(a.text, /get_topic/);
    assert.equal(a.data.url, 'https://x.test/theme/agent-security-incidents');
  });
  test('a missing theme lists the themes there are, as an error', () => {
    const a = themeMissing('nope', 'https://x.test', [{ slug: 'a-b', name: 'A b' }]);
    assert.equal(a.error, true); assert.match(a.text, /`a-b`/);
  });
});

describe('a theme decides the lens of its stories', async () => {
  const { lensMatch } = await import('../src/signal/lens.ts');
  test('the theme lens wins over the words; without one, the words', () => {
    const sec = { key: 'security', terms: ['breach'] }, agents = { key: 'agents', terms: ['agent'] };
    assert.equal(lensMatch(agents, { term: 'agent breach', themeLens: 'security' }), false);
    assert.equal(lensMatch(sec, { term: 'agent tool', themeLens: 'security' }), true);
    assert.equal(lensMatch(agents, { term: 'agent breach', themeLens: null }), true);
  });
});
