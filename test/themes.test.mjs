// Themes: which theme a story is in, how candidates are found and tested, the review of themes that exist, the centre that follows slowly, names.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  THEME_DRIFT_MAX, THEME_RETIRE_WEEKS, assignTheme, discoverThemes, driftOf, followCentre, moreLikeThese, parseThemeName, refuseName, reviewThemes, suggestLens, themeCurve, themeSlug,
  themeSystem, themeUser, weeksNeeded,
} from '../src/signal/themes.ts';
import { seedLenses } from '../src/signal/lens.ts';
import { topicSlug } from '../src/signal/topicpage.ts';

function rnd(seed) { let a = seed; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const DIM = 48, DAY = 86_400_000, NOW = Date.parse('2026-11-13T00:00:00Z');
const r = rnd(11), dir = () => Array.from({ length: DIM }, () => r() - 0.5);
const BG = dir().map((x) => 2 * x);   // the area's common part
const OWN = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map((k) => [k, dir()]));
const day = (w) => new Date(NOW - (w * 7 + 2) * DAY).toISOString().slice(0, 10);   // a day in week w (0 is the newest)

let nextId = 1;
/** A story near the direction `own`: `weeks` are the weeks it has items in, `groups` the source groups, `n` its items. */
function story({ own, weeks = [0], groups = ['x', 'y', 'z'], n = 10, theme = null, noise = 0.3, id }) {
  const rr = rnd(1000 + nextId), v = BG.map((b, j) => b + 1.2 * own[j] + noise * (rr() - 0.5) * 2);
  const days = {};
  weeks.forEach((w, i) => { days[day(w)] = Object.fromEntries(groups.map((g) => [g, Math.max(1, Math.round(n / (weeks.length * groups.length)))])); });
  const sid = id ?? 's' + String(nextId++).padStart(3, '0');
  return { id: sid, name: 'story ' + sid, centre: v, first: NOW - (Math.max(...weeks) * 7 + 3) * DAY, last: NOW - (Math.min(...weeks) * 7 + 1) * DAY, n, days, theme };
}
const spread = (k, f) => Array.from({ length: k }, (_, i) => f(i));
const noiseStories = () => spread(14, () => story({ own: dir(), weeks: [1], groups: ['x', 'y'] }));
/** A lasting, broad group: 8 stories over four weeks and three source groups. */
const lasting = (own) => spread(8, (i) => story({ own, weeks: [i % 4, (i + 1) % 4], groups: ['x', 'y', 'z'] }));
const run = (stories, extra = {}) => discoverThemes({ stories, themes: [], rejected: [], areaItems: 3000, bg: BG, now: NOW, ...extra });
const findGroup = (res, ids) => [...res.candidates, ...res.rejected].find((c) => ids.every((i) => c.stories.includes(i)));
const theme = (id, own, extra = {}) => { const c = BG.map((b, j) => b + 1.2 * own[j]); return { id, name: id, sentence: '', inside: '', outside: '', lens: null, centre: c, approvedCentre: c, state: 'active', ...extra }; };

describe('assigning a story', () => {
  const ta = theme('ta', OWN.a), tb = theme('tb', OWN.b);
  test('the closest theme wins, a story near nothing is uncharted', () => {
    assert.equal(assignTheme(story({ own: OWN.a }).centre, [ta, tb], BG), 'ta');
    assert.equal(assignTheme(story({ own: OWN.b }).centre, [tb, ta], BG), 'tb');
    assert.equal(assignTheme(story({ own: OWN.c }).centre, [ta, tb], BG), null);
    assert.equal(assignTheme(story({ own: OWN.a }).centre, [], BG), null);
  });
  test('a retired theme takes no new stories', () => {
    assert.equal(assignTheme(story({ own: OWN.a }).centre, [{ ...ta, state: 'retired' }], BG), null);
  });
});

describe('discovering themes', () => {
  test('a lasting group in several source groups becomes a candidate with all tests passed', () => {
    const a = lasting(OWN.a), res = run([...a, ...noiseStories()]);
    const c = res.candidates.find((x) => a.every((s) => x.stories.includes(s.id)));
    assert.ok(c, JSON.stringify(res.rejected.map((x) => [x.stories.length, x.failed])));
    assert.equal(c.passed, true);
    assert.deepEqual(c.failed, []);
    assert.equal(c.tests.length, 7);
    assert.ok(c.tests.every((t) => typeof t.value === 'number' && typeof t.need === 'number' && 'margin' in t));
    assert.equal(c.curve.length, 8);
    assert.equal(c.typical.length, 5);
    assert.equal(c.nearest, null);
  });
  test('a group in one source group fails Broad in sources', () => {
    const b = spread(8, (i) => story({ own: OWN.b, weeks: [i % 4, (i + 1) % 4], groups: ['x'] })), res = run([...b, ...noiseStories()]);
    assert.ok(!res.candidates.some((c) => b.every((s) => c.stories.includes(s.id))));
    assert.ok(findGroup(res, b.map((s) => s.id)).failed.includes('sources'));
  });
  test('a group where one story holds most of the items fails Not a story', () => {
    const c = spread(8, (i) => story({ own: OWN.c, weeks: [i % 4, (i + 1) % 4], n: i === 0 ? 400 : 5 })), res = run([...c, ...noiseStories()]);
    assert.ok(findGroup(res, c.map((s) => s.id)).failed.includes('single'));
    assert.ok(!res.candidates.some((x) => c.every((s) => x.stories.includes(s.id))));
  });
  test('a group that is a big share of the area fails Not generic', () => {
    const a = lasting(OWN.a), res = run([...a, ...noiseStories()], { areaItems: 300 });
    const g = findGroup(res, a.map((s) => s.id));
    assert.ok(g.failed.includes('share'));
    assert.equal(res.candidates.length, 0);
  });
  test('a group seen in one week only fails Lasting, and a young history lowers the bar', () => {
    const d = spread(8, () => story({ own: OWN.d, weeks: [0] })), res = run([...d, ...noiseStories()], { historyWeeks: 6 });
    assert.ok(findGroup(res, d.map((s) => s.id)).failed.includes('weeks'));
    assert.equal(weeksNeeded(6), 3); assert.equal(weeksNeeded(4), 2); assert.equal(weeksNeeded(2), 2); assert.equal(weeksNeeded(1), 2, 'one week never shows that something lasts');
    const young = run([...d, ...noiseStories()], { historyWeeks: 1 }), g = findGroup(young, d.map((s) => s.id)).tests.find((t) => t.id === 'weeks');
    assert.equal(g.need, 2, 'with one week of history two active weeks are still asked for');
  });
  test('too few stories fail Lasting', () => {
    const e = spread(3, (i) => story({ own: OWN.e, weeks: [i, i + 1] })), res = run([...e, ...lasting(OWN.a), ...lasting(OWN.b)]);
    assert.ok(!res.candidates.some((c) => e.some((s) => c.stories.includes(s.id))));
  });
  test('a group near a centre the admin said no to, or near a theme, is not proposed', () => {
    const a = lasting(OWN.a), all = [...a, ...noiseStories()], centre = BG.map((b, j) => b + 1.2 * OWN.a[j]);
    const no = run(all, { rejected: [{ id: 'x1', centre }] });
    assert.ok(!no.candidates.some((c) => a.every((s) => c.stories.includes(s.id))));
    assert.ok(findGroup(no, a.map((s) => s.id)).failed.includes('seen'));
    assert.ok(findGroup(no, a.map((s) => s.id)).nearestRejected.sim > 0.65);
    const yes = run(all, { themes: [theme('old', OWN.a, { name: 'Old theme' })] });
    assert.ok(!yes.candidates.some((c) => a.every((s) => c.stories.includes(s.id))));
    assert.equal(findGroup(yes, a.map((s) => s.id)).nearest.name, 'Old theme');
  });
  test('stories already in a theme or older than the window are left out', () => {
    const a = lasting(OWN.a).map((s) => ({ ...s, theme: 't1' }));
    assert.equal(run([...a, ...noiseStories()]).candidates.length, 0);
    const old = lasting(OWN.a).map((s) => ({ ...s, last: NOW - 100 * DAY }));
    assert.equal(run(old).looked, 0);
  });
  test('the same input in any order gives the same answer', () => {
    const all = [...lasting(OWN.a), ...lasting(OWN.b), ...noiseStories()], a = run(all), b = run([...all].reverse());
    assert.deepEqual(a, b);
    assert.deepEqual(a, run(all));
  });
  test('no stories, or very few, give nothing and do not fail', () => {
    assert.equal(run([]).candidates.length, 0);
    assert.equal(run(noiseStories().slice(0, 2)).candidates.length, 0);
  });
});

describe('reviewing themes', () => {
  const inTheme = (id, own, k, extra = {}) => spread(k, (i) => story({ own, weeks: [i % 3], theme: id, ...extra }));
  test('retire after six quiet weeks, not before', () => {
    const t = theme('ta', OWN.a), quiet = spread(6, (i) => ({ ...story({ own: OWN.a, weeks: [THEME_RETIRE_WEEKS + 1], theme: 'ta' }) })), fresh = inTheme('ta', OWN.a, 5);
    const p = reviewThemes({ themes: [t], stories: quiet, bg: BG, now: NOW });
    assert.deepEqual(p.filter((x) => x.kind === 'retire').map((x) => x.theme), ['ta']);
    assert.equal(reviewThemes({ themes: [t], stories: fresh, bg: BG, now: NOW }).filter((x) => x.kind === 'retire').length, 0);
    assert.equal(reviewThemes({ themes: [{ ...t, state: 'retired' }], stories: quiet, bg: BG, now: NOW }).length, 0);
  });
  test('a split is found when the stories form two clear groups', () => {
    const t = theme('ta', OWN.a), half = (own) => spread(7, (i) => story({ own: own.map((x, j) => x + OWN.a[j]), weeks: [i % 3], theme: 'ta', noise: 0.15 }));
    const sides = [OWN.b, OWN.c].map((o) => o.map((x) => x * 1.5)), one = half(sides[0]), two = half(sides[1]);
    const p = reviewThemes({ themes: [t], stories: [...one, ...two], bg: BG, now: NOW }).find((x) => x.kind === 'split');
    assert.ok(p);
    assert.deepEqual(p.sides.map((s) => s.length).sort(), [7, 7]);
    assert.deepEqual([...p.sides[0]].sort(), p.sides[0].every((id) => one.some((s) => s.id === id)) ? one.map((s) => s.id).sort() : two.map((s) => s.id).sort());
  });
  test('one tight group is not split', () => {
    const t = theme('ta', OWN.a);
    assert.equal(reviewThemes({ themes: [t], stories: inTheme('ta', OWN.a, 14), bg: BG, now: NOW }).filter((x) => x.kind === 'split').length, 0);
  });
  test('two themes that have grown together are proposed for a merge', () => {
    const close = OWN.a.map((x, j) => x + 0.05 * OWN.b[j]);
    const p = reviewThemes({ themes: [theme('ta', OWN.a), theme('tb', close), theme('tc', OWN.c)], stories: [...inTheme('ta', OWN.a, 3), ...inTheme('tb', close, 3), ...inTheme('tc', OWN.c, 3)], bg: BG, now: NOW });
    assert.deepEqual(p.filter((x) => x.kind === 'merge').map((x) => x.themes), [['ta', 'tb']]);
  });
  test('a theme whose stories moved away is drifted', () => {
    const t = theme('ta', OWN.a), moved = spread(6, (i) => story({ own: OWN.d, weeks: [i % 3], theme: 'ta' }));
    assert.ok(reviewThemes({ themes: [t], stories: moved, bg: BG, now: NOW }).some((x) => x.kind === 'drifted'));
    assert.ok(!reviewThemes({ themes: [t], stories: inTheme('ta', OWN.a, 6), bg: BG, now: NOW }).some((x) => x.kind === 'drifted'));
  });
});

describe('the centre follows its stories', () => {
  test('it moves a little at a time towards them', () => {
    const t = theme('ta', OWN.a), target = story({ own: OWN.a.map((x, j) => x + 0.3 * OWN.b[j]) }).centre, next = followCentre(t, [target], BG);
    assert.ok(driftOf(next, t.approvedCentre, BG) > 0);
    assert.ok(driftOf(next, target, BG) < driftOf(t.centre, target, BG));
  });
  test('never past the drift limit on its own, however long the stories stay away', () => {
    const t = theme('ta', OWN.a), far = story({ own: OWN.d.map((x) => x * 3) }).centre;
    let c = t;
    for (let i = 0; i < 200; i++) c = { ...t, centre: followCentre(c, [far], BG) };
    assert.ok(driftOf(c.centre, t.approvedCentre, BG) <= THEME_DRIFT_MAX + 1e-6, String(driftOf(c.centre, t.approvedCentre, BG)));
    assert.ok(driftOf(c.centre, t.approvedCentre, BG) > THEME_DRIFT_MAX * 0.9, 'it did move up to the limit');
  });
  test('no stories, no move', () => {
    const t = theme('ta', OWN.a);
    assert.deepEqual(followCentre(t, [], BG), Array.from(t.centre));
  });
});

describe('more like these', () => {
  test('finds the free stories near the examples, nearest first, and skips the ones in a theme', () => {
    const near = spread(5, () => story({ own: OWN.a })), far = spread(5, () => story({ own: OWN.d })), taken = story({ own: OWN.a, theme: 't1' });
    const res = moreLikeThese([near[0].centre, near[1].centre], [...near, ...far, taken], BG);
    assert.deepEqual(res.stories.map((x) => x.id).sort(), near.map((s) => s.id).sort());
    assert.equal(res.centre.length, DIM);
    assert.ok(res.stories.every((x, i, a) => !i || a[i - 1].sim >= x.sim));
    assert.deepEqual(moreLikeThese([], near, BG), { centre: [], stories: [] });
  });
});

describe('curve, slug, lens', () => {
  test('the curve counts items per week, oldest first', () => {
    const s = story({ own: OWN.a, weeks: [0, 2], groups: ['x'], n: 10 });
    assert.deepEqual(themeCurve([s], 4, NOW), [0, 5, 0, 5]);
  });
  test('a slug is made like a topic slug', () => {
    assert.equal(themeSlug('Agent security incidents'), 'agent-security-incidents');
    assert.equal(themeSlug('C++ tooling'), topicSlug('C++ tooling'));
  });
  test('a lens is suggested by its words, or none', () => {
    const lenses = seedLenses('ai');
    const sec = lenses.find((l) => l.terms.includes('security')) ?? lenses[0];
    assert.equal(suggestLens(['zzz qqq', 'xxyy'], lenses), null);
    assert.equal(suggestLens([sec.terms[0] + ' news', 'unrelated'], lenses) !== null, true);
  });
});

describe('names', () => {
  const good = '{"name":"Agent security incidents","sentence":"Breaches of agent tools.","notConfused":"Prompt injection research","inside":"real incidents","outside":"papers"}';
  test('the prompt carries the stories, titles and the neighbour; the system text states the rules', () => {
    const m = themeUser([{ name: 'claude code backdoor', titles: ['a', 'b', 'c'] }], 'Prompt injection');
    assert.match(m.content, /claude code backdoor/); assert.match(m.content, /Prompt injection/); assert.doesNotMatch(m.content, /· c/);
    assert.match(themeSystem().content, /2 to 5 words/);
  });
  test('a good answer is read, with the neighbour it must not be confused with', () => {
    assert.deepEqual(parseThemeName('```json\n' + good + '\n```'), { name: 'Agent security incidents', sentence: 'Breaches of agent tools.', notConfused: 'Prompt injection research', inside: 'real incidents', outside: 'papers' });
  });
  test('vague, too short, too long, linked, repeated or broken answers are refused', () => {
    const named = (n) => JSON.stringify({ name: n, sentence: 's' });
    for (const bad of ['AI', 'Machine learning', 'AI agents', 'Artificial intelligence', 'Agents', 'one two three four five six', 'See https://x.y now', '']) assert.equal(parseThemeName(named(bad)), null, bad);
    assert.equal(parseThemeName('not json'), null);
    assert.equal(parseThemeName(good, ['agent security incidents']), null);
    assert.equal(refuseName('Agent security incidents'), null);
    assert.equal(refuseName('OpenAI Google'), 'too vague');
  });
});
