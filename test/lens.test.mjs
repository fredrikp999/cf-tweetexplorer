// Lenses: colours, matching, ordering with the "outside your lens" pick, and the model's suggestions.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { BIG_SHARE, LENS_COLORS, LENS_JS, LENS_PALETTE, PAGE_BG, applyLens, chosenLens, cleanLens, cleanTerm, contrast, lensColorCss, lensMatch, lensesOfTopic, parseSuggestions, seedLenses, suggestSystem, suggestUser } from '../src/signal/lens.ts';

const sec = { terms: ['security', 'prompt injection', 'breach'] };
const t = (term, signal = 1, o = {}) => ({ term, label: term, members: [], signal, ...o });

describe('colours', () => {
  test('every shade reads on the page and on a card, in both themes', () => {
    for (const c of LENS_COLORS) {
      for (const bg of PAGE_BG.light) assert.ok(contrast(LENS_PALETTE[c].light, bg) >= 4.5, `${c} light on ${bg}: ${contrast(LENS_PALETTE[c].light, bg).toFixed(2)}`);
      for (const bg of PAGE_BG.dark) assert.ok(contrast(LENS_PALETTE[c].dark, bg) >= 4.5, `${c} dark on ${bg}: ${contrast(LENS_PALETTE[c].dark, bg).toFixed(2)}`);
    }
  });
  test('there are six, and the css defines each in both themes', () => {
    assert.equal(LENS_COLORS.length, 6);
    const css = lensColorCss();
    for (const c of LENS_COLORS) { assert.ok(css.includes(`--lc-${c}:${LENS_PALETTE[c].light}`)); assert.ok(css.includes(`--lc-${c}:${LENS_PALETTE[c].dark}`)); assert.ok(css.includes(`.lc-${c}{`)); }
  });
});

describe('lensMatch', () => {
  test('a term matches as whole words, in any name of the topic', () => {
    assert.ok(lensMatch(sec, t('mcp security flaw')));
    assert.ok(lensMatch(sec, t('x', 1, { label: 'a prompt injection attack' })));
    assert.ok(lensMatch(sec, t('x', 1, { members: ['scribd breaches'] })));
    assert.ok(!lensMatch(sec, t('insecurity report')));
    assert.ok(!lensMatch(sec, t('prompt engineering')));
  });
  test('plural and singular are one word; words must be in a row', () => {
    assert.ok(lensMatch({ terms: ['agent'] }, t('coding agents')));
    assert.ok(!lensMatch({ terms: ['prompt injection'] }, t('prompt then injection')));
  });
  test('an empty lens holds nothing; a topic can be in several lenses', () => {
    assert.ok(!lensMatch({ terms: [] }, t('security')));
    assert.equal(lensesOfTopic([sec, { terms: ['mcp'] }, { terms: ['rag'] }], t('mcp security flaw')).length, 2);
  });
  test('the five seeds are well formed and find their own kind of topic', () => {
    const seeds = seedLenses('ai');
    assert.equal(seeds.length, 5);
    assert.deepEqual(seeds.map((l) => l.key), ['security', 'agentic', 'observability', 'data', 'models']);
    assert.equal(new Set(seeds.map((l) => l.color)).size, 5);
    for (const l of seeds) assert.deepEqual(cleanLens(l, []), l);
    assert.ok(lensMatch(seeds[0], t('mcp auth bypass')));
    assert.ok(lensMatch(seeds[1], t('claude code backdoor')));
    assert.ok(lensMatch(seeds[2], t('opentelemetry llm spec')));
    const pol = seedLenses('politics');
    assert.equal(pol.length, 5);
    assert.equal(new Set(pol.map((l) => l.color)).size, 5);
    assert.ok(pol.every((l) => l.area === 'politics'));
    for (const l of pol) assert.deepEqual(cleanLens(l, []), l);
    assert.ok(lensMatch(pol[0], t('german election poll')));
    assert.match(suggestSystem(pol, 'politics').content, /about politics/);
  });
});

describe('applyLens', () => {
  const list = [t('openai model release', 10), t('mcp security flaw', 6), t('kimi k2', 3), t('scribd breach', 2), t('rag tips', 1)];
  test('lens topics first in their own order, the rest after, nothing removed', () => {
    const a = applyLens(list, sec);
    assert.deepEqual(a.ordered.map((x) => x.topic.term), ['mcp security flaw', 'scribd breach', 'openai model release', 'kimi k2', 'rag tips']);
    assert.deepEqual(a.ordered.map((x) => x.inLens), [true, true, false, false, false]);
    assert.equal(a.inCount, 2);
  });
  test('the big topic outside the lens breaks through; small ones do not; at most two', () => {
    assert.deepEqual(applyLens(list, sec).outside.map((x) => x.term), ['openai model release']);
    const many = [t('a b', 10), t('c d', 9), t('e f', 8), t('mcp security flaw', 7)];
    assert.deepEqual(applyLens(many, sec).outside.map((x) => x.term), ['a b', 'c d']);
    assert.ok(BIG_SHARE > 0);
  });
  test('a part goes with its parent', () => {
    const l = [t('claude code', 5), t('claude code backdoor', 4, { parent: 'claude code' }), t('kimi k2', 3)];
    const a = applyLens(l, { terms: ['backdoor'] });
    assert.deepEqual(a.ordered.map((x) => x.topic.term), ['claude code backdoor', 'claude code', 'kimi k2']);   // the part matches itself; its parent is not in
    const b = applyLens(l, { terms: ['claude code'] });
    assert.deepEqual(b.ordered.map((x) => [x.topic.term, x.inLens]), [['claude code', true], ['claude code backdoor', true], ['kimi k2', false]]);
  });
  test('no lens changes nothing', () => {
    const a = applyLens(list, null);
    assert.deepEqual(a.ordered.map((x) => x.topic.term), list.map((x) => x.term));
    assert.deepEqual(a.outside, []);
  });
  test('an address names a lens only if it exists', () => {
    const ls = [{ key: 'security' }];
    assert.equal(chosenLens(ls, 'security'), ls[0]);
    assert.equal(chosenLens(ls, 'nope'), undefined);
    assert.equal(chosenLens(ls, null), undefined);
  });
});

describe('cleanLens', () => {
  const ok = { key: 'Security', name: ' Security ', color: 'blue', terms: ['Prompt  Injection', 'prompt injection', '<b>', 'x', 'CVE'] };
  test('cleans the fields', () => {
    const l = cleanLens(ok);
    assert.equal(l.key, 'security'); assert.equal(l.name, 'Security'); assert.equal(l.area, 'ai');
    assert.deepEqual(l.terms, ['prompt injection', 'cve']);
  });
  test('terms may come as text', () => assert.deepEqual(cleanLens({ ...ok, terms: 'rag, vector search\nsql' }).terms, ['rag', 'vector search', 'sql']));
  test('refuses a bad key, no name, an unknown colour, or a colour another lens in the area has', () => {
    assert.throws(() => cleanLens({ ...ok, key: '1x' }), /key/);
    assert.throws(() => cleanLens({ ...ok, name: ' ' }), /name/);
    assert.throws(() => cleanLens({ ...ok, color: 'pink' }), /colour/);
    assert.throws(() => cleanLens(ok, [{ key: 'data', area: 'ai', color: 'blue' }]), /colour/);
    assert.doesNotThrow(() => cleanLens(ok, [{ key: 'data', area: 'politics', color: 'blue' }, { key: 'security', area: 'ai', color: 'blue' }]));
  });
  test('cleanTerm', () => { assert.equal(cleanTerm('  GPT-5 '), 'gpt-5'); assert.equal(cleanTerm('a'), null); assert.equal(cleanTerm('<script>'), 'script'); });
});

describe('suggestions', () => {
  const lenses = [{ key: 'security', name: 'Security', description: 'attacks' }, { key: 'data', name: 'Data', description: '' }];
  const topics = ['mcp auth bypass', 'kimi k2', 'vector search'];
  test('the prompt names the lenses and numbers the topics', () => {
    assert.match(suggestSystem(lenses).content, /security: Security - attacks/);
    assert.match(suggestUser(topics).content, /1\. mcp auth bypass\n2\. kimi k2/);
  });
  test('numbers become topic names; unknown keys, bad numbers and repeats are dropped', () => {
    const r = parseSuggestions('```json\n{"lenses":{"security":[1,1,9,"x"],"data":[3],"made-up":[2]}}\n```', lenses, topics);
    assert.deepEqual(r, { security: ['mcp auth bypass'], data: ['vector search'] });
  });
  test('rubbish gives nothing', () => { assert.deepEqual(parseSuggestions('no', lenses, topics), {}); assert.deepEqual(parseSuggestions('{"lenses":[1]}', lenses, topics), {}); });
});

test('the served script is not inline-dependent and guards storage', () => {
  assert.match(LENS_JS, /try\{/);
  assert.ok(!/<script/i.test(LENS_JS));
});
