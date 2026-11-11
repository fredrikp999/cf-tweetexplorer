// The Depth chart: breadth from reach, a place for every topic on every day, and the same thing in words.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DEPTH_DAYS, DEPTH_H, DEPTH_W, FLOOR_Y, MIN_CLIMB, SURFACE_Y, breadthOf, climbOf, depthLayout, reachSeries, reachWords, zoneOf } from '../src/signal/depth.ts';
import { climbs, inZone, risingOf, risingOut } from '../src/site/rising.ts';
import { KINDS, TOPICS, WATCHED, info, life, rawFixture } from './helpers/depth-fixture.mjs';

const ALL = { kinds: 4, groups: 5, sources: 100 };
const lens = { key: 'security', area: 'ai', name: 'Security', description: '', color: 'orange', terms: ['mcp', 'prompt injection'] };

describe('breadth', () => {
  test('nothing is 0, everything is 1, and more reach is never less breadth', () => {
    assert.equal(breadthOf({ kinds: 0, groups: 0, sources: 0 }, ALL), 0);
    assert.equal(breadthOf({ kinds: 4, groups: 5, sources: 100 }, ALL), 1);
    const one = breadthOf({ kinds: 1, groups: 1, sources: 1 }, ALL), few = breadthOf({ kinds: 1, groups: 1, sources: 5 }, ALL), wide = breadthOf({ kinds: 3, groups: 4, sources: 5 }, ALL);
    assert.ok(0 < one && one < few && few < wide && wide < 1);
  });
  test('the first sources count for more than the last', () => {
    const b = (s) => breadthOf({ kinds: 1, groups: 1, sources: s }, ALL);
    assert.ok(b(5) - b(1) > b(100) - b(96));
  });
  test('a part with one thing to reach is left out', () => {
    assert.equal(breadthOf({ kinds: 1, groups: 2, sources: 3 }, { kinds: 1, groups: 2, sources: 3 }), 1);
    assert.equal(breadthOf({ kinds: 1, groups: 1, sources: 1 }, { kinds: 1, groups: 1, sources: 1 }), 1);
  });
  test('one place is deep, everywhere is the surface', () => {
    assert.equal(zoneOf(breadthOf({ kinds: 1, groups: 1, sources: 3 }, ALL)), 'deep');
    assert.equal(zoneOf(breadthOf({ kinds: 2, groups: 3, sources: 12 }, ALL)), 'mid');
    assert.equal(zoneOf(breadthOf({ kinds: 4, groups: 4, sources: 40 }, ALL)), 'surface');
  });
});

describe('reach per day', () => {
  test('looks back over the window, counts kinds as bits, and leaves out sources it does not know', () => {
    const daily = life((d) => (d === 5 ? ['x0', 'hn0', 'nobody'] : d === 6 ? ['x0', 'rss20'] : []));
    const r = reachSeries(daily, info, KINDS);
    assert.equal(r.length, DEPTH_DAYS);
    assert.deepEqual(r[4], { k: 0, g: 0, s: 0, m: 0 });
    assert.deepEqual(r[5], { k: 0b0011, g: 2, s: 2, m: 2 });
    assert.deepEqual(r[6], { k: 0b1011, g: 3, s: 3, m: 4 });   // x0 twice, hn0, rss20
    assert.deepEqual(r[8], { k: 0b1001, g: 2, s: 2, m: 2 });   // day 5 has dropped out of the three days
    assert.deepEqual(r[9], { k: 0, g: 0, s: 0, m: 0 });
  });
  test('says it in words', () => {
    assert.equal(reachWords({ k: 0b0011, g: 2, s: 14, m: 30 }, KINDS, WATCHED), 'on X and Hacker News (2 of 4 kinds of source), 2 of 5 groups, 14 of 100 sources');
    assert.equal(reachWords({ k: 0, g: 0, s: 0, m: 0 }, KINDS, WATCHED), 'no source had it');
  });
});

describe('the layout', () => {
  const raw = rawFixture(), by = new Map(raw.topics.map((t) => [t.key, t]));
  test('is the same every time', () => assert.deepEqual(rawFixture(), raw));
  test('depth is exactly breadth: the wider, the higher', () => {
    for (const t of raw.topics) t.b.forEach((b, d) => {
      if (b === 0) { assert.equal(t.y[d], null); assert.equal(t.x[d], null); return; }
      assert.ok(Math.abs(t.y[d] - (FLOOR_Y - b * (FLOOR_Y - SURFACE_Y))) < 0.3);
      assert.ok(t.y[d] >= SURFACE_Y && t.y[d] <= FLOOR_Y);
    });
    assert.ok(by.get('claude-code').y[13] < by.get('otel-llm-spans').y[13]);
  });
  test('bubbles stay in the box and do not overlap on any day', () => {
    for (let d = 0; d < DEPTH_DAYS; d++) {
      const here = raw.topics.filter((t) => t.y[d] !== null);
      for (const t of here) assert.ok(t.x[d] - t.r >= 0 && t.x[d] + t.r <= DEPTH_W && t.y[d] <= DEPTH_H);
      for (let i = 0; i < here.length; i++) for (let j = i + 1; j < here.length; j++) {
        const a = here[i], b = here[j];
        assert.ok(Math.hypot(a.x[d] - b.x[d], a.y[d] - b.y[d]) >= a.r + b.r - 1, `${a.key} and ${b.key} overlap on day ${d}`);
      }
    }
  });
  test('the ones around longest are to the left of the newest', () => {
    assert.equal(by.get('claude-code').first, 0); assert.equal(by.get('vibe-ops').first, 12);
    assert.ok(by.get('claude-code').x[13] < by.get('vibe-ops').x[13]);
  });
  test('a bigger share of items is a bigger bubble', () => assert.ok(by.get('claude-code').r > by.get('agent-memory').r && by.get('agent-memory').r > by.get('vibe-ops').r));
  test('names the steepest climbs, and not what sank or stood still', () => {
    assert.equal(raw.rising[0], 'mcp-auth-bypass');
    assert.ok(raw.rising.includes('eval-leakage'));
    assert.ok(!raw.rising.includes('rag') && !raw.rising.includes('claude-code') && raw.rising.length <= 5);
    for (const k of raw.rising) assert.ok(by.get(k).rise >= MIN_CLIMB);
    assert.ok(by.get('rag').rise < 0);
  });
  test('a climb compares now with some days ago', () => {
    assert.deepEqual(climbOf([0, 0, 0.25, 0.25, 0.25, 0.25, 0.75], 4), { from: 0.25, to: 0.75, rise: 0.5 });
    assert.equal(climbOf([0.5], 4).rise, 0);
  });
  test('no topics, no picture', () => assert.deepEqual(depthLayout([], KINDS, WATCHED).topics, []));
});

describe('the page, the JSON and the tool', () => {
  const O = 'https://site.example';
  test('joins the lenses: with none a topic takes its first lens colour, with one only its own topics have a colour', () => {
    const d = risingOf(rawFixture(), { area: 'ai', lenses: [lens], origin: O }), t = (k, x = d) => x.topics.find((y) => y.slug === k);
    assert.equal(t('mcp-auth-bypass').lensColor, 'orange'); assert.equal(t('rag').lensColor, null); assert.equal(t('rag').inLens, null);
    assert.equal(t('mcp-auth-bypass').url, O + '/t/mcp-auth-bypass'); assert.equal(t('vibe-ops').state, 'new'); assert.equal(t('rag').state, 'falling');
    const l = risingOf(rawFixture(), { area: 'ai', lens, lenses: [lens], origin: O });
    assert.equal(t('prompt-injection', l).inLens, true); assert.equal(t('rag', l).inLens, false); assert.deepEqual(l.lens, { key: 'security', name: 'Security' });
    assert.deepEqual(climbs(l).map((x) => x.slug), ['mcp-auth-bypass']);   // only the lens's own climbs
    assert.equal(inZone(l, 'mid')[0].inLens, true);
  });
  test('every topic is in one zone, or in none when no source has it now', () => {
    const d = risingOf(rawFixture(), { area: 'ai', lenses: [], origin: O });
    assert.equal(inZone(d, 'surface').length + inZone(d, 'mid').length + inZone(d, 'deep').length, d.topics.filter((t) => t.zone).length);
    assert.ok(inZone(d, 'surface').some((t) => t.slug === 'claude-code')); assert.ok(inZone(d, 'deep').some((t) => t.slug === 'otel-llm-spans'));
  });
  test('the answer leads with the steepest climb, gives reach in its own words, and says what breadth is', () => {
    const a = risingOut(risingOf(rawFixture(), { area: 'ai', lenses: [lens], origin: O }), O);
    assert.match(a.text, /Steepest climb: \[MCP auth bypass\]\(https:\/\/site\.example\/t\/mcp-auth-bypass\)/);
    assert.match(a.text, /## Rising from the deep\n1\. \[MCP auth bypass\]/); assert.match(a.text, /## At the surface/); assert.match(a.text, /## In the deep/);
    assert.match(a.text, /of 4 kinds of source\), \d of 5 groups, \d+ of 100 sources/); assert.match(a.text, /Reach, not reactions/); assert.match(a.text, /\*\*Next:\*\*.*get_topic/);
    assert.equal(a.data.topics.length, TOPICS.length); assert.ok(a.text.length < 6000);
  });
  test('politics links say so, and nothing to draw is said plainly', () => {
    assert.match(risingOut(risingOf(rawFixture(), { area: 'politics', lenses: [], origin: O }), O, 'politics').text, /\/t\/claude-code\?area=politics/);
    const none = risingOut(risingOf(null, { area: 'ai', lenses: [], origin: O }), O);
    assert.match(none.text, /nothing to place yet/); assert.deepEqual(none.data.topics, []); assert.ok(!none.error);
  });
});
