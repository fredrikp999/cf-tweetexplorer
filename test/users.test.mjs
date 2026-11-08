// Readers: addresses, roles and what they give, settings, own lenses, followed topics, questions, and the links an answer may keep.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DEFAULT_ROLES, EXTRA_ASK_PER_DAY, MAX_OWN_LENSES, NO_PREFS, accessOf, cleanEmail, cleanFollow, cleanOwnLens, cleanPrefs, cleanQuestion, cleanRoles, homeFor, keepLinks } from '../src/users/model.ts';

describe('addresses', () => {
  test('lowercased and trimmed', () => assert.equal(cleanEmail('  Anna.B@Gmail.com '), 'anna.b@gmail.com'));
  test('not an address: null', () => { for (const x of ['', 'anna', 'a@b', 'a b@c.com', null]) assert.equal(cleanEmail(x), null); });
});

describe('roles', () => {
  test('Reader is always first and gives nothing', () => {
    const r = cleanRoles([{ key: 'reader', name: 'Everyone', features: ['ask'], askPerDay: 50 }, { key: 'analyst', name: 'Analyst', features: ['ask'], askPerDay: 5 }]);
    assert.deepEqual(r[0], { key: 'reader', name: 'Everyone', features: [], askPerDay: 0 });
    assert.deepEqual(r[1], { key: 'analyst', name: 'Analyst', features: ['ask'], askPerDay: 5 });
  });
  test('unknown features are dropped; no ask means no questions', () => assert.deepEqual(cleanRoles([{ key: 'vip', name: 'VIP', features: ['fly', 'ask', 'ask'], askPerDay: 999 }])[1], { key: 'vip', name: 'VIP', features: ['ask'], askPerDay: 200 }));
  test('a role without features has no questions', () => assert.equal(cleanRoles([{ key: 'plain', features: [], askPerDay: 30 }])[1].askPerDay, 0));
  test('bad and repeated keys are refused', () => {
    assert.throws(() => cleanRoles([{ key: 'Not ok' }]), /role key/);
    assert.throws(() => cleanRoles([{ key: 'aa' }, { key: 'aa' }]), /two roles/);
  });
});

describe('what a reader may do', () => {
  test('the role gives features and questions', () => assert.deepEqual(accessOf({ role: 'analyst', extra: [] }, DEFAULT_ROLES).askPerDay, 20));
  test('nobody and an unknown role are Readers', () => {
    assert.deepEqual(accessOf(null, DEFAULT_ROLES).features, []);
    assert.equal(accessOf({ role: 'gone', extra: [] }, DEFAULT_ROLES).role.key, 'reader');
  });
  test('an extra feature on a Reader gets the extra number of questions', () => {
    const a = accessOf({ role: 'reader', extra: ['ask'] }, DEFAULT_ROLES);
    assert.deepEqual([a.features, a.askPerDay], [['ask'], EXTRA_ASK_PER_DAY]);
  });
});

describe('settings', () => {
  test('a lens key and a window, or the defaults', () => {
    assert.deepEqual(cleanPrefs({ lens: 'Security', window: '3' }), { lens: 'security', window: 3 });
    assert.deepEqual(cleanPrefs({ lens: '<x>', window: 5 }), NO_PREFS);
  });
  test('the front page moves only for a choice that is not the default', () => {
    assert.equal(homeFor(NO_PREFS, () => true), null);
    assert.deepEqual(homeFor({ lens: 'security', window: 1 }, () => true), { lens: 'security', window: 1 });
    assert.deepEqual(homeFor({ lens: 'gone', window: 7 }, () => false), { lens: '', window: 7 });
    assert.equal(homeFor({ lens: 'gone', window: 1 }, () => false), null);
  });
});

describe('own lenses', () => {
  test('the key comes from the name, with the own prefix; terms are cleaned', () => {
    const l = cleanOwnLens({ name: 'My GPU watch', terms: 'GPU, nvidia\ncuda' }, []);
    assert.equal(l.key, 'my-my-gpu-watch');
    assert.deepEqual(l.terms, ['gpu', 'nvidia', 'cuda']);
    assert.ok(l.color);
  });
  test('editing keeps the key; a new lens gets a colour not in use', () => {
    const a = cleanOwnLens({ name: 'Chips', terms: 'tsmc' }, []), b = cleanOwnLens({ name: 'Rust', terms: 'rust' }, [a]);
    assert.notEqual(a.color, b.color);
    assert.equal(cleanOwnLens({ key: a.key, name: 'Chips again', terms: 'tsmc', color: a.color }, [a, b]).key, a.key);
  });
  test('at most so many', () => {
    const mine = Array.from({ length: MAX_OWN_LENSES }, (_, i) => cleanOwnLens({ name: 'Lens ' + i, terms: 'x' + i, color: undefined }, []));
    assert.throws(() => cleanOwnLens({ name: 'One more', terms: 'y' }, mine), /at most/);
  });
});

describe('follows and questions', () => {
  test('a topic address, with a label and an area', () => {
    assert.deepEqual(cleanFollow({ slug: 'kimi-k2', area: 'x', label: '' }), { slug: 'kimi-k2', area: 'ai', label: 'kimi k2' });
    assert.equal(cleanFollow({ slug: '../etc' }), null);
  });
  test('a question is trimmed and capped; too short is none', () => {
    assert.equal(cleanQuestion('  What  changed?  '), 'What changed?');
    assert.equal(cleanQuestion('?'), null);
    assert.equal(cleanQuestion('x'.repeat(900)).length, 500);
  });
});

describe('links in an answer', () => {
  const ok = new Set(['https://news.example.com/a']);
  test('a link from the data stays', () => assert.equal(keepLinks('See [the post](https://news.example.com/a).', ok), 'See [the post](https://news.example.com/a).'));
  test('any other link becomes plain text', () => {
    assert.equal(keepLinks('Click [here](https://evil.example.com/login) now', ok), 'Click here now');
    assert.equal(keepLinks('Go to https://evil.example.com/x today', ok), 'Go to evil.example.com/x today');
  });
});
