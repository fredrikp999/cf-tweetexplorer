// The Research map: grouping papers, joining groups for less detail, and reading the names a model gives.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { clusterPapers, cutAt, groupsFor, nameFromTerms, nameUser, parseNames } from '../src/signal/paperClusters.ts';
import { HOST_JS, VIZ_VIEWS } from '../src/site/viz.ts';
import html from '../src/apps/map.ts';
import { storageDayCost, storageMonth } from '../src/lib/storagePrices.ts';

// Three subjects, two of them close to each other, as small vectors with some spread.
const around = (centre, n, words) => Array.from({ length: n }, (_, i) => ({
  title: `${words} study ${i}`, abstract: `We look at ${words} in detail.`,
  vector: centre.map((x, k) => x + 0.04 * Math.sin(i * 7 + k * 3)),
}));
const CODE = around([1, 0.2, 0, 0], 30, 'code repair'), TESTS = around([1, 0, 0.2, 0], 20, 'unit tests'), SAFETY = around([0, 0, 0, 1], 25, 'prompt injection');
const PAPERS = [...CODE, ...TESTS, ...SAFETY];

describe('grouping', () => {
  test('papers on one subject end up together', () => {
    const r = clusterPapers(PAPERS, 3), a = r.assign;
    assert.equal(new Set(a.slice(0, 30)).size, 1);
    assert.equal(new Set(a.slice(50)).size, 1);
    assert.notEqual(a[0], a[50]);
  });
  test('the same papers give the same groups', () => {
    assert.deepEqual(clusterPapers(PAPERS, 3).assign, clusterPapers(PAPERS, 3).assign);
  });
  test('groups are numbered largest first, and each has its telling terms and typical papers', () => {
    const r = clusterPapers(PAPERS, 3), n = r.leaves.map((_, g) => r.assign.filter((x) => x === g).length);
    assert.deepEqual(n, [...n].sort((a, b) => b - a));
    assert.ok(r.leaves[0].terms.some(([t]) => /code|repair/.test(t)), JSON.stringify(r.leaves[0].terms));
    for (const [g, l] of r.leaves.entries()) { assert.ok(l.central.length); for (const i of l.central) assert.equal(r.assign[i], g); }
  });
  test('close subjects join first, so less detail never mixes distant ones', () => {
    const r = clusterPapers(PAPERS, 3), roots = cutAt(r.joins, 3, 2);
    assert.equal(roots[r.assign[0]], roots[r.assign[30]]);
    assert.notEqual(roots[r.assign[0]], roots[r.assign[50]]);
  });
  test('asking for every group joins nothing; asking for one joins all', () => {
    const r = clusterPapers(PAPERS, 3);
    assert.deepEqual(cutAt(r.joins, 3, 3), [0, 1, 2]);
    assert.equal(new Set(cutAt(r.joins, 3, 1)).size, 1);
  });
  test('few papers or none do not break it', () => {
    assert.deepEqual(clusterPapers([]), { assign: [], leaves: [], joins: [] });
    assert.deepEqual(clusterPapers(PAPERS.slice(0, 1)).assign, [0]);
    assert.equal(clusterPapers(PAPERS.slice(0, 2), 40).assign.length, 2);
  });
  test('the number of groups follows the papers, up to 40', () => {
    assert.equal(groupsFor(4000), 40); assert.equal(groupsFor(90000), 40); assert.equal(groupsFor(1494), 24); assert.equal(groupsFor(1), 1);
  });
});

describe('names', () => {
  test('what the model says is kept per cluster, and what is unusable is left out', () => {
    const names = parseNames('Here you go: {"clusters":[{"i":1,"name":"Coding agents","summary":"Agents that fix code."},{"i":2,"name":""},{"i":9,"name":"Out of range"},{"i":3,"name":"' + 'x'.repeat(90) + '"}]}', 3);
    assert.deepEqual([...names.keys()], [0]);
    assert.equal(names.get(0).name, 'Coding agents');
  });
  test('an answer that is not JSON gives no names', () => {
    assert.equal(parseNames('I cannot help', 3).size, 0);
    assert.equal(parseNames('{"clusters": 7}', 3).size, 0);
    assert.equal(parseNames('{broken', 3).size, 0);
  });
  test('without a name, the words stand in', () => {
    assert.equal(nameFromTerms([['prompt injection', 9], ['attack', 5], ['defense', 2], ['more', 1]]), 'Prompt injection, attack, defense');
    assert.equal(nameFromTerms([]), 'Other papers');
  });
  test('the request numbers the clusters from one', () => {
    assert.match(nameUser([{ titles: ['A title'], terms: ['x'] }]), /^Cluster 1\nTerms: x\nTitles:\n- A title$/);
  });
});

describe('the view', () => {
  const script = /<script>([\s\S]*)<\/script>/.exec(html)[1];
  test('one inline script that parses, and nothing loaded from outside', () => {
    assert.equal((html.match(/<script/g) ?? []).length, 1);
    assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=|import\s*\(/);
    assert.doesNotThrow(() => new Function(script));
  });
  test('it is served, and its host only reads paper addresses it can check', () => {
    assert.equal(VIZ_VIEWS['map.html'], html);
    assert.match(HOST_JS, /kind === 'map' && name === 'get_paper'/);
    assert.ok(new Function(HOST_JS));
  });
  test('it says everything a paper shows through an escape', () => {
    assert.match(script, /esc\(p\[PTITLE\]\)/);
    assert.match(script, /esc\(a\.data\.abstract\)/);
  });
  test('the cut in the browser is the same steps as the tested one', () => {
    assert.match(script, /slice\(0, Math\.max\(0, k - S\.detail\)\)/);
  });
});

describe('Cloudflare storage prices', () => {
  test('a month at list price, and after what is included', () => {
    assert.deepEqual(storageMonth('do', 1e9), { list: 0.2, billed: 0 });
    assert.ok(Math.abs(storageMonth('do', 6e9).billed - 0.2) < 1e-9);
    assert.ok(Math.abs(storageMonth('r2', 20e9).billed - 0.15) < 1e-9);
    assert.equal(storageMonth('r2', 5e9).billed, 0);
  });
  test('thirty days add up to one month at list price', () => {
    assert.ok(Math.abs(storageDayCost('do', 2e9) * 30 - 0.4) < 1e-9);
    assert.equal(storageDayCost('r2', -5), 0);
  });
});

describe('the rules for arXiv', () => {
  const src = readFileSync(new URL('../src/durable-objects/monitor.ts', import.meta.url), 'utf8');
  test('the map only uses titles and abstracts, and links to the paper', () => {
    assert.match(src, /`\$\{r\.title\}\. \$\{r\.abstract\}`/);
    assert.doesNotMatch(html, /arxiv\.org\/pdf/);
  });
  test('its pages are read through the same gate as everything else', () => {
    assert.match(readFileSync(new URL('../src/sources/arxiv.ts', import.meta.url), 'utf8'), /export async function arxivPage[\s\S]{0,300}await get\(/);
  });
});
