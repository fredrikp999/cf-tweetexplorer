// Stories on the pages (src/signal/storyview.ts): areas of groups, first names, addresses, the counts Signal scores, backfill steps, and which story an address leads to.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  STORY_SLUG_MAX, chunkBySpan, groupAreas, isNewInWindow, provisionalName, relatedByNames, storyAliases, storyCounts, storyFor, uniqueSlug,
} from '../src/signal/storyview.ts';
import { TOPIC_SLUG, topicSlug } from '../src/signal/topicpage.ts';
import { scoreTerms } from '../src/signal/score.ts';

describe('groupAreas', () => {
  test('a group takes the area of the first board that holds it; none stored is AI', () => {
    const m = groupAreas([{ groups: ['g:a', 'g:b'] }, { groups: ['g:b', 'g:c'], area: 'politics' }]);
    assert.equal(m.get('g:a'), 'ai'); assert.equal(m.get('g:b'), 'ai'); assert.equal(m.get('g:c'), 'politics'); assert.equal(m.get('g:d'), undefined);
  });
});

describe('provisionalName', () => {
  test('the first name that can be shown', () => {
    assert.equal(provisionalName(['claude', 'Claude Code leak', 'other thing']), 'claude code leak');
  });
  test('falls back to the first name, then to a placeholder', () => {
    assert.equal(provisionalName(['kimi']), 'kimi');
    assert.equal(provisionalName([]), 'new story');
  });
});

describe('uniqueSlug', () => {
  test('the plain address when free, else a number', () => {
    const taken = new Set(['kimi-k3-release', 'kimi-k3-release-2']);
    assert.equal(uniqueSlug('openssh pre-auth flaw', (s) => taken.has(s)), 'openssh-pre-auth-flaw');
    assert.equal(uniqueSlug('kimi k3 release', (s) => taken.has(s)), 'kimi-k3-release-3');
  });
  test('always an address topicSlug leaves alone, within the length', () => {
    for (const n of ['c++ in the kernel', 'a'.repeat(80) + ' b', '', 'Ünïcode näme', 'x--y', 'gpt-5 launch']) {
      const s = uniqueSlug(n, () => false);
      assert.ok(TOPIC_SLUG.test(s), s); assert.equal(topicSlug(s), s); assert.ok(s.length <= 60, s);
      const s2 = uniqueSlug(n, (x) => x === s);
      assert.ok(TOPIC_SLUG.test(s2) && topicSlug(s2) === s2 && s2 !== s, s2);
    }
    assert.ok(uniqueSlug('a'.repeat(80) + ' b', () => false).length <= STORY_SLUG_MAX);
  });
});

describe('storyCounts', () => {
  const of = new Map([['w1', 'g1'], ['w2', 'g1'], ['w3', 'g2'], ['w4', 'g3']]);
  test('items per story and group, only allowed groups', () => {
    const { counts, voices } = storyCounts([{ story: 's1', watch: 'w1', n: 2 }, { story: 's1', watch: 'w2', n: 1 }, { story: 's1', watch: 'w3', n: 4 }, { story: 's1', watch: 'w4', n: 9 }, { story: 's2', watch: 'w3', n: 1 }],
      of, new Set(['g1', 'g2']), new Map([['g1', 2], ['g2', 1]]));
    assert.deepEqual(counts.get('s1'), { g1: 3, g2: 4 });
    assert.equal(voices.get('s1'), 3);
    assert.equal(voices.get('s2'), 2, 'the only source of its group counts as two');
  });
  test('scored like terms, by story id', () => {
    const { counts, voices } = storyCounts([{ story: 'ab', watch: 'w1', n: 5 }, { story: 'ab', watch: 'w3', n: 5 }], of, new Set(['g1', 'g2']), new Map([['g1', 2], ['g2', 1]]));
    const r = scoreTerms({ groups: [{ key: 'g1', name: 'G1', weight: 1 }, { key: 'g2', name: 'G2', weight: 1 }], items: { g1: 50, g2: 50 }, prevItems: {}, cur: counts, prev: new Map(), voices, minVoices: 2 });
    assert.equal(r.terms.length, 1); assert.equal(r.terms[0].term, 'ab'); assert.equal(r.terms[0].breadth, 2);
  });
});

describe('chunkBySpan', () => {
  test('rows within the span of the first, at least one', () => {
    const H = 3_600_000, rows = [{ ts: 0 }, { ts: 5 * H }, { ts: 12 * H }, { ts: 13 * H }];
    assert.equal(chunkBySpan(rows).length, 3);
    assert.equal(chunkBySpan([{ ts: 0 }, { ts: 100 * H }]).length, 1);
    assert.deepEqual(chunkBySpan([]), []);
  });
});

describe('storyFor', () => {
  const stories = [
    { id: 'a', slug: 'claude-code-source-leak', oldSlugs: ['claude-code-leak'], name: 'claude code source leak', names: ['claude code leak', 'npm source maps'] },
    { id: 'b', slug: 'kimi-k3-release', oldSlugs: [], name: 'kimi k3 release', names: ['kimi k3', 'moonshot'] },
  ];
  test('its own address, then an old one, then a name', () => {
    assert.equal(storyFor('kimi-k3-release', stories)?.how, 'slug');
    assert.deepEqual([storyFor('claude-code-leak', stories)?.story.id, storyFor('claude-code-leak', stories)?.how], ['a', 'old']);
    assert.deepEqual([storyFor('npm-source-maps', stories)?.story.id, storyFor('npm-source-maps', stories)?.how], ['a', 'name']);
    assert.equal(storyFor('kimi-k3', stories)?.story.id, 'b');
    assert.equal(storyFor('nothing', stories), null);
  });
});

describe('relatedByNames', () => {
  test('stories that share a name, most shared first, not itself', () => {
    const own = { id: 'a', name: 'claude code leak', names: ['npm source maps', 'anthropic security'] };
    const others = [own, { id: 'b', name: 'x', names: ['anthropic security'] }, { id: 'c', name: 'npm source maps', names: ['anthropic security'] }, { id: 'd', name: 'y', names: ['z'] }];
    assert.deepEqual(relatedByNames(own, others), ['c', 'b']);
  });
});

describe('storyAliases and the New mark', () => {
  test('other names leave out its own', () => {
    assert.deepEqual(storyAliases('Kimi K3', ['kimi k3', 'moonshot', 'a', 'b', 'c', 'd']), ['moonshot', 'a', 'b', 'c']);
  });
  test('new only when born new inside the window', () => {
    assert.equal(isNewInWindow({ bornNew: true, first: 10 }, 5), true);
    assert.equal(isNewInWindow({ bornNew: true, first: 1 }, 5), false);
    assert.equal(isNewInWindow({ bornNew: false, first: 10 }, 5), false);
  });
});
