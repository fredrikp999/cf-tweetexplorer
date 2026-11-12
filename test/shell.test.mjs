// The shell of the public views (A10): panels and the back stack, picking, what the model is told, questions, and that the site's host gets none of it.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import vm from 'node:vm';
import { SHELL_CSS, SHELL_JS } from '../src/apps/shell.ts';

// ---- a page small enough to read: just the DOM calls the shell makes
function node(tag) {
  const n = { tag, children: [], className: '', attrs: {}, style: {},
    get childNodes() { return n.children; }, get firstChild() { return n.children[0] ?? null; },
    appendChild(c) { n.children.push(c); return c; },
    insertBefore(c, ref) { const i = ref ? n.children.indexOf(ref) : -1; if (i < 0) n.children.push(c); else n.children.splice(i, 0, c); return c; },
    setAttribute(k, v) { n.attrs[k] = v; }, focus() {}, querySelector(sel) { return find(n, (x) => x.tag === sel); },
    classList: { toggle(c, on) { const s = new Set(n.className.split(' ').filter(Boolean)); if (on === undefined ? !s.has(c) : on) s.add(c); else s.delete(c); n.className = [...s].join(' '); }, contains(c) { return n.className.split(' ').includes(c); } },
    set textContent(v) { n.children = []; n.text = String(v); }, get textContent() { return (n.text ?? '') + n.children.map((c) => c.textContent).join(''); } };
  return n;
}
const find = (n, f) => { for (const c of n.children) { if (f(c)) return c; const r = find(c, f); if (r) return r; } return null; };
const all = (n, f, out = []) => { for (const c of n.children) { if (f(c)) out.push(c); all(c, f, out); } return out; };
const button = (n, text) => all(n, (x) => x.tag === 'button' && x.textContent.startsWith(text))[0];
const same = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));   // objects made inside the vm have another Object, so compare as text

/** Runs the shell in a fake frame whose host has these capabilities. */
function boot(caps) {
  const sent = [], listeners = [], notes = [], counts = { redraw: 0 };
  const document = { createElement: node, createTextNode: (t) => ({ tag: '#text', children: [], textContent: t }), addEventListener() {}, activeElement: null };
  const window = { addEventListener: (_, fn) => listeners.push(fn), scrollY: 0, scrollTo() {} };
  const ctx = vm.createContext({ document, window, parent: { postMessage: (m) => sent.push(m) }, setTimeout, clearTimeout });
  vm.runInContext(SHELL_JS + ';this.UC = UC;', ctx);
  const root = node('div');
  ctx.UC.init({ title: 'Landscape', host: caps, root, note: (t) => notes.push(t), size() {}, site: () => 'https://s.example/', context: () => 'VIEW CTX',
    state: () => ({ lens: 'security', window: 7, area: 'ai' }), redraw() { counts.redraw++; }, saveBase: () => 'https://s.example/me/save' });
  const calls = () => sent.filter((m) => m.method === 'tools/call');
  const of = (method) => sent.filter((m) => m.method === method);
  const reply = (id, result) => listeners.forEach((f) => f({ data: { id, result } }));
  const part = (id) => root.children.find((c) => c.id === id);
  return { UC: ctx.UC, sent, root, reply, notes, counts, calls, of, part };
}
const later = (ms) => new Promise((r) => setTimeout(r, ms));

const TOPIC = { slug: 'mcp-auth', label: 'MCP auth bypass', url: 'https://s.example/t/mcp-auth', state: 'rising', summary: { text: 'Sum.', day: '2026-11-10', itemCount: 5 }, evidence: [{ label: 'X', lines: ['about 2k likes'] }], sourcesShown: true,
  talk: [{ id: 'k3f9a2c81bd', kind: 'x', title: 'A post', url: 'https://x.com/a/1', by: 'a', source: 'X', reactionsText: 'about 20 likes' }],
  papers: { list: [{ id: '2511.00001', title: 'P', url: 'https://arxiv.org/abs/2511.00001', uptake: { discussed: false } }], thanks: 'Thank you to arXiv' }, briefings: [], related: [{ slug: 'oauth', label: 'OAuth' }], questions: ['Why did MCP auth bypass peak on Tuesday?'] };
const ITEM = { id: 'k3f9a2c81bd', url: 'https://s.example/t/mcp-auth/i/k3f9a2c81bd', topic: { slug: 'mcp-auth', label: 'MCP auth bypass' }, kind: 'x', title: 'A post', by: 'a', source: 'X', date: '10 Nov', original: 'https://x.com/a/1',
  reactionsText: 'about 20 likes', why: { words: 'W', placeWords: '3rd of 12' }, copies: 2, before: null, after: { id: 'zzzzzzzzzzz', title: 'Next' }, alsoIn: [] };
const APP = { message: {}, updateModelContext: {} };

describe('house rules', () => {
  test('nothing that would end the view\'s template or its script', () => {
    for (const s of [SHELL_JS, SHELL_CSS]) { assert.ok(!s.includes('`')); assert.ok(!s.includes('${')); assert.doesNotMatch(s, /<\/?script/i); }
    assert.ok(!SHELL_JS.includes('innerHTML'), 'text from tools is only ever set as text');
    new vm.Script(SHELL_JS);
    assert.ok(SHELL_JS.length < 24_000, 'the shell is added to every view: keep it small');
  });
});

describe('panels and the back stack', () => {
  test('a topic opens in place, with its own request ids', () => {
    const b = boot(APP);
    assert.equal(b.UC.open('topic', { topic: 'mcp-auth' }), true);
    assert.equal(b.calls()[0].params.name, 'get_topic'); same(b.calls()[0].params.arguments, { topic: 'mcp-auth' });
    assert.ok(b.calls()[0].id > 100000);
    assert.ok(b.root.classList.contains('ucon'), 'the view under the panel is hidden');
    b.reply(b.calls()[0].id, { structuredContent: TOPIC });
    assert.ok(b.part('ucp').textContent.includes('MCP auth bypass'));
    assert.ok(b.part('ucp').textContent.includes('Thank you to arXiv'), 'papers never show without the thank-you line');
    assert.ok(b.part('ucbar').textContent.includes('Landscape › MCP auth bypass'));
  });
  test('topic, item, the next item, and back twice to the view as it was', () => {
    const b = boot(APP);
    b.UC.open('topic', { topic: 'mcp-auth' }); b.reply(b.calls()[0].id, { structuredContent: TOPIC });
    button(b.part('ucp'), 'In context').onclick();
    same(b.calls()[1].params.arguments, { topic: 'mcp-auth', item: 'k3f9a2c81bd' }); assert.equal(b.UC.depth(), 2);
    b.reply(b.calls()[1].id, { structuredContent: ITEM });
    assert.ok(b.part('ucp').textContent.includes('3rd of 12'));
    button(b.part('ucp'), 'After').onclick();
    assert.equal(b.UC.depth(), 2, 'stepping to the next item replaces the panel, so Back goes to the list');
    assert.equal(b.calls()[2].params.arguments.item, 'zzzzzzzzzzz');
    b.reply(b.calls()[2].id, { isError: true, content: [{ type: 'text', text: 'left' }], structuredContent: { gone: true, url: 'https://x.com/a/2' } });
    assert.ok(b.part('ucp').textContent.includes('has left the topic'), 'an item that left its topic is an answer, not a failure');
    b.UC.back();
    assert.equal(b.UC.depth(), 1); assert.ok(b.part('ucp').textContent.includes('Sum.')); assert.equal(b.calls().length, 3, 'the topic under it was kept, not asked for again');
    b.UC.back();
    assert.equal(b.UC.depth(), 0); assert.ok(!b.root.classList.contains('ucon')); assert.equal(b.counts.redraw, 1);
  });
  test('an answer that comes after the reader went back is dropped', () => {
    const b = boot(APP);
    b.UC.open('topic', { topic: 'a' }); b.UC.back(); b.reply(b.calls()[0].id, { structuredContent: TOPIC });
    assert.equal(b.UC.depth(), 0); assert.ok(!b.root.classList.contains('ucon'));
  });
  test('a failed read says so and Back still works', () => {
    const b = boot(APP);
    b.UC.open('topic', { topic: 'nope' }); b.reply(b.calls()[0].id, { isError: true, content: [{ type: 'text', text: 'No published topic' }] });
    assert.ok(b.part('ucp').textContent.includes('Could not read it')); b.UC.back(); assert.equal(b.UC.depth(), 0);
  });
  test('the stack is twelve deep at most', () => {
    const b = boot(APP);
    for (let i = 0; i < 15; i++) b.UC.open('paper', { id: '2511.0000' + i });
    assert.equal(b.UC.depth(), 12); b.UC.reset(); assert.equal(b.UC.depth(), 0);
  });
  test('the title of the view can be a function, read when the trail is drawn', () => {
    const b = boot(APP); let name = 'First';
    b.UC.init({ title: () => name, host: APP, root: b.root, size() {} }); name = 'Second'; b.UC.step('OAuth', () => {});
    assert.ok(b.part('ucbar').textContent.includes('Second \u203A OAuth'));
  });
  test('a step the view drew itself: Back calls its undo, and no panel covers the view', () => {
    const b = boot(APP); let undone = 0;
    b.UC.step('OAuth', () => undone++);
    assert.equal(b.UC.depth(), 1); assert.ok(!b.root.classList.contains('ucon')); b.UC.back(); assert.equal(undone, 1);
  });
  test('politics is passed on, and only then', () => {
    const b = boot(APP);
    b.UC.open('topic', { topic: 'x', area: 'politics' }); b.UC.open('item', { topic: 'x', item: 'aaaaaaaaaaa', area: 'ai' }); b.UC.open('paper', { id: '2511.00001' });
    same(b.calls().map((c) => c.params.arguments), [{ topic: 'x', area: 'politics' }, { topic: 'x', item: 'aaaaaaaaaaa' }, { id: '2511.00001' }]);
  });
});

describe('picking, telling and asking', () => {
  test('what the model is told: where, the state, the view\'s own words, the picks', () => {
    const b = boot(APP);
    b.UC.pick('item:u', { k: 'item', label: 'L', url: 'https://x.com/a/1' }); b.UC.pick('paper:1', { k: 'paper', label: 'P', id: '1', url: 'u' });
    const t = b.UC.contextText();
    assert.ok(t.startsWith('Undercurrent. Looking at: Landscape (lens: security, window: 7).')); assert.ok(t.includes('VIEW CTX')); assert.ok(t.includes('- paper: P (id 1'));
  });
  test('several changes in a row are told once, and the same text is not told twice', async () => {
    const b = boot(APP);
    b.UC.tell(); b.UC.tell(); b.UC.pick('a', { k: 'item', label: 'L', url: 'u' }); await later(700);
    assert.equal(b.of('ui/update-model-context').length, 1);
    b.UC.tell(); await later(700); assert.equal(b.of('ui/update-model-context').length, 1);
  });
  test('the foot bar: count, ask, save to a list with at most ten addresses, clear', () => {
    const b = boot(APP);
    for (let i = 0; i < 12; i++) b.UC.pick('item:' + i, { k: 'item', label: 'L' + i, url: 'https://x.com/a/' + i, t: 'mcp-auth' });
    b.UC.pick('topic:t', { k: 'topic', label: 'T', slug: 't', url: 'https://s.example/t/t' });
    assert.ok(b.part('ucfoot').textContent.includes('13 picked'));
    button(b.part('ucfoot'), 'Save to a list').onclick();
    const url = b.of('ui/open-link').pop().params.url;
    assert.ok(url.startsWith('https://s.example/me/save?t=mcp-auth&u=https%3A%2F%2Fx.com%2Fa%2F0&t=mcp-auth&u=')); assert.equal(url.split('&u=').length - 1, 10); assert.ok(!url.includes('%2Ft%2Ft'), 'a topic is not something to save');
    button(b.part('ucfoot'), 'Ask Claude').onclick(); assert.ok(b.of('ui/message')[0].params.content[0].text.includes('The user picked:'));
    button(b.part('ucfoot'), 'Clear').onclick(); assert.equal(b.UC.chosen().length, 0);
  });
  test('at most twenty picks are kept', () => {
    const b = boot(APP);
    for (let i = 0; i < 25; i++) b.UC.pick('k' + i, { k: 'item', label: 'L', url: 'u' + i });
    assert.equal(b.UC.chosen().length, 20);
  });
  test('suggested questions: three at most, odd ones dropped, a click asks', () => {
    const b = boot(APP);
    b.UC.suggest(['Why did X peak on Tuesday?', 'x', 7, 'Which papers are behind X?', 'How did X get from Hacker News to X?', 'A fourth question?']);
    assert.equal(all(b.part('ucq'), (n) => n.tag === 'button').length, 3);
    b.UC.refresh(); assert.ok(!b.part('ucq').classList.contains('hide'), 'questions stay shown after a redraw');
    button(b.part('ucq'), 'Why did').onclick(); assert.ok(b.of('ui/message')[0].params.content[0].text.startsWith('Why did X peak'));
  });
});

describe('hosts', () => {
  test('the site\'s host (only openLinks): no panel, nothing told, nothing asked, no bar', async () => {
    const b = boot({ openLinks: {} });
    assert.equal(b.UC.open('topic', { topic: 'x' }), false);
    b.UC.pick('a', { k: 'item', label: 'L', url: 'u' }); b.UC.tell(); b.UC.suggest(['Why did X peak on Tuesday?']); await later(700);
    assert.equal(b.sent.length, 0); assert.ok(b.part('ucbar').classList.contains('hide')); assert.ok(b.part('ucfoot').classList.contains('hide'));
    b.UC.refresh(); assert.ok(b.part('ucq').classList.contains('hide'), 'no empty question box under the view');
  });
  test('a host that lists nothing gets everything, as the views have always done', () => {
    assert.equal(boot({}).UC.open('paper', { id: '2511.00001' }), true);
  });
});
