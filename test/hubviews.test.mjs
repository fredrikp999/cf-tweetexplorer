// The Topic hub and the Research map views: their inline scripts parse, the views keep to the house rules, and the hub speaks only the messages the host knows.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import hub from '../src/apps/topichub.ts';
import map from '../src/apps/map.ts';
import land from '../src/apps/landscape.ts';

const script = (html) => /<script>([\s\S]*)<\/script>/.exec(html)[1];

describe('view scripts', () => {
  for (const [name, html] of [['topic hub', hub], ['research map', map], ['landscape', land]]) {
    it(`${name}: one classic inline script that parses`, () => {
      assert.equal((html.match(/<script/g) ?? []).length, 1);
      assert.doesNotMatch(html, /type="module"/);
      new Script(script(html));
    });
  }
  it('the hub asks only for what the server offers', () => {
    const s = script(hub);
    const names = [...s.matchAll(/name: '([a-z_]+)'/g)].map((m) => m[1]).sort();
    assert.deepEqual([...new Set(names)], ['get_topic', 'get_topic_items']);
    for (const m of ['ui/open-link', 'ui/message', 'ui/update-model-context', 'ui/request-display-mode', 'ui/initialize']) assert.ok(s.includes(m), m);
  });
  it('the map asks for its data with the app-only tool and keeps the thank-you line', () => {
    const s = script(map);
    assert.ok(s.includes("name: 'get_research_map'"));
    assert.ok(s.includes('d.thanks'));
  });
  it('the hub uses the shell for Back, picks and telling the model', () => {
    const s = script(hub);
    for (const call of ['UC.init(', 'UC.step(', 'UC.pick(', 'UC.tell()', "UC.open('item'", "UC.open('paper'"]) assert.ok(s.includes(call), call);
    assert.doesNotMatch(hub, /id="back"|id="site"|id="ask"/);
  });
  it('the landscape opens a topic in place and falls back to the page', () => {
    const s = script(land);
    assert.match(s, /UC\.open\('topic'[\s\S]{0,120}return; \}[\s\S]{0,40}openPage\(b\)/);
    assert.ok(s.includes('Show me the topic'), 'the panel still offers the full view (it is in the shell)');
  });
});
