import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { HOST_JS, VIZ_VIEWS, viewCsp, vizFrame } from '../src/site/viz.ts';

describe('the frame of a view', () => {
  for (const [name, html] of Object.entries(VIZ_VIEWS)) {
    test(`${name} may run only its own script, sandboxed, with no network`, async () => {
      const csp = await viewCsp(html), script = /<script>([\s\S]*)<\/script>/.exec(html)[1];
      assert.ok(csp.includes(`'sha256-${createHash('sha256').update(script).digest('base64')}'`));
      assert.match(csp, /default-src 'none'/); assert.match(csp, /sandbox allow-scripts(;|$)/);
      assert.doesNotMatch(csp, /connect-src|unsafe-eval|allow-same-origin|script-src[^;]*unsafe-inline/);
    });
  }
  test('the frame on the page is sandboxed without its origin, and has no address until the host is listening', () => {
    const f = vizFrame('first', '/signal/x/first', 'T');
    assert.match(f, /sandbox="allow-scripts"/); assert.doesNotMatch(f, /allow-same-origin/); assert.doesNotMatch(f, /\ssrc="\/viz\/first/);
  });
});

/** Runs host.js against a fake page: what it sends the frame, fetches and opens. */
function host(kind, base) {
  const sent = [], fetched = [], opened = [], listeners = [], classes = new Set(), contentWindow = { postMessage: (m) => sent.push(m) };
  const f = { dataset: { kind, base }, contentWindow, style: {}, classList: { contains: (c) => classes.has(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) } };
  const window = { addEventListener: (_, fn) => listeners.push(fn), open: (...a) => opened.push(a) };
  const fetch = (path) => { fetched.push(path); return Promise.resolve({ ok: !path.includes('missing'), text: () => Promise.resolve('{"a":1}') }); };
  let listeningWhenLoaded = null;
  Object.defineProperty(f, 'src', { set(v) { f.loaded = v; listeningWhenLoaded = listeners.length > 0; } });
  vm.runInNewContext(HOST_JS, { document: { getElementById: () => f }, window, fetch, Number, String, Math });
  assert.equal(listeningWhenLoaded, true, 'the view says hello once, so the host must listen before the frame loads');
  const say = (data, source = contentWindow) => listeners[0]({ source, data });
  return { say, sent, fetched, opened, f, settle: () => new Promise((r) => setTimeout(r)) };
}

describe('the host script', () => {
  test('loads the view of its own kind', () => {
    assert.equal(host('first', '/signal/x/first').f.loaded, '/viz/first.html'); assert.equal(host('galaxy', '/history/r/galaxy').f.loaded, '/viz/galaxy.html');
  });
  test('ignores messages that do not come from its frame', () => {
    const h = host('first', '/signal/x/first');
    h.say({ id: 1, method: 'ui/initialize' }, {});
    assert.equal(h.sent.length, 0);
  });
  test('answers the handshake, then gives the view its first data', async () => {
    const h = host('first', '/signal/x/first');
    h.say({ id: 1, method: 'ui/initialize' });
    assert.equal(h.sent[0].id, 1); assert.equal(h.sent[0].result.hostCapabilities.message, undefined);
    h.say({ method: 'ui/notifications/initialized' }); await h.settle();
    assert.deepEqual(h.fetched, ['/signal/x/first/14.json']);
    assert.equal(h.sent[1].method, 'ui/notifications/tool-result'); assert.equal(h.sent[1].params.content[0].text, '{"a":1}');
  });
  test('reads only the addresses that belong to its own picture', async () => {
    const first = host('first', '/signal/x/first'), galaxy = host('galaxy', '/history/r/galaxy');
    first.say({ id: 2, method: 'tools/call', params: { name: 'get_who_said_first', arguments: { days: 7 } } });
    galaxy.say({ id: 2, method: 'tools/call', params: { name: 'get_galaxy_points', arguments: { offset: 2000, limit: 1000 } } });
    assert.deepEqual(first.fetched, ['/signal/x/first/7.json']); assert.deepEqual(galaxy.fetched, ['/history/r/galaxy/2000.json']);
    for (const [h, name, args] of [[first, 'get_who_said_first', { days: 3 }], [first, 'get_costs', {}], [galaxy, 'get_tweet_galaxy', { id: 'x' }], [galaxy, 'get_galaxy_points', { offset: '../../admin' }]]) {
      const before = h.fetched.length;
      h.say({ id: 3, method: 'tools/call', params: { name, arguments: args } });
      assert.equal(h.fetched.length, before); assert.ok(h.sent.at(-1).error);
    }
  });
  test('a failed read reaches the view as an error, not as data', async () => {
    const h = host('galaxy', '/history/missing/galaxy');
    h.say({ method: 'ui/notifications/initialized' }); await h.settle();
    assert.equal(h.sent[0].params.isError, true); assert.doesNotMatch(h.sent[0].params.content[0].text, /"a"/);
  });
  test('opens only https links, and without giving them this page', () => {
    const h = host('first', '/signal/x/first');
    h.say({ id: 4, method: 'ui/open-link', params: { url: 'javascript:alert(1)' } });
    h.say({ id: 5, method: 'ui/open-link', params: { url: 'http://a.example' } });
    assert.equal(h.opened.length, 0);
    h.say({ id: 6, method: 'ui/open-link', params: { url: 'https://a.example' } });
    assert.deepEqual(h.opened[0], ['https://a.example', '_blank', 'noopener,noreferrer']);
  });
  test('tells the view nothing about Claude: it cannot send it context or messages', () => {
    const h = host('first', '/signal/x/first');
    h.say({ id: 7, method: 'ui/update-model-context', params: {} }); h.say({ id: 8, method: 'ui/message', params: {} });
    assert.ok(h.sent[0].error); assert.ok(h.sent[1].error);
  });
  test('fullscreen stops the view resizing its frame, and leaving it restores that', () => {
    const h = host('first', '/signal/x/first');
    h.say({ method: 'ui/notifications/size-changed', params: { height: 800 } }); assert.equal(h.f.style.height, '800px');
    h.say({ id: 9, method: 'ui/request-display-mode', params: { mode: 'fullscreen' } }); assert.equal(h.sent.at(-1).result.mode, 'fullscreen');
    h.say({ method: 'ui/notifications/size-changed', params: { height: 300 } }); assert.equal(h.f.style.height, '800px');
    h.say({ id: 10, method: 'ui/request-display-mode', params: { mode: 'inline' } }); assert.equal(h.sent.at(-1).result.mode, 'inline');
  });
});
