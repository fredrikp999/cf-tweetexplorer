# SPEC A10: the shell of the views, step by step

The build specification for proposal **A10** of [ux-proposals.md](ux-proposals.md). It replaces the A10 section of
[SPEC-ux-proposals.md](SPEC-ux-proposals.md) wherever the two differ ([section 2](#2-what-changed-from-the-first-a10-spec) lists the
differences). It is written so that it can be followed without designing anything: every step names the files, gives the code or the
exact edit, and says how to check it.

Written against commit `7aca61c`. The code of step 1 (the shell and its test) was run before it was put here: 16 tests pass.

## Contents

1. [What is built](#1-what-is-built)
2. [What changed from the first A10 spec](#2-what-changed-from-the-first-a10-spec)
3. [Rules for whoever builds it](#3-rules-for-whoever-builds-it)
4. [The four views today](#4-the-four-views-today)
5. [Step 1: the shell and its test](#5-step-1-the-shell-and-its-test)
6. [Step 2: the server](#6-step-2-the-server)
7. [Step 3: the Topic hub](#7-step-3-the-topic-hub)
8. [Step 4: the Landscape](#8-step-4-the-landscape)
9. [Step 5: the Depth chart](#9-step-5-the-depth-chart)
10. [Step 6: the Research map](#10-step-6-the-research-map)
11. [Step 7: the site](#11-step-7-the-site)
12. [Step 8: documents](#12-step-8-documents)
13. [Checking a view by hand](#13-checking-a-view-by-hand)
14. [Not in this work](#14-not-in-this-work)

---

## 1. What is built

One file, `src/apps/shell.ts`, that every public view includes. It gives a view:

| | What the reader gets |
| --- | --- |
| **A bar** | `← Back`, a trail line (`Landscape › MCP auth bypass › A post`), and *Open on the site* |
| **Panels** | A topic, an item or a paper opens **in place**, over the view, from any view. Back returns to the view as it was |
| **Picking** | Ticks in panels and in the Topic hub; one foot bar: *3 picked · Ask Claude about these · Save to a list · Clear* |
| **Telling the model** | After every change the model gets one short text: where the reader is, the lens and window, what is picked |
| **Suggested questions** | Up to three buttons under a view, written by the server from the data; a click asks Claude |

Around it: four small server changes, one new page on the site (`/me/save`), and an *Open in Claude* line on four site pages.

Eight steps. **Each step is one commit, leaves `npm run check` green, and can be deployed on its own.** Do them in order.

| Step | Changes | View address after |
| --- | --- | --- |
| 1 | `src/apps/shell.ts`, `test/shell.test.mjs` (new; nothing uses them yet) | |
| 2 | `src/site/questions.ts`, `test/questions.test.mjs` (new); `agentText.ts`, `agentMcp.ts` | |
| 3 | `src/apps/topichub.ts` | `topic-v4` |
| 4 | `src/apps/landscape.ts` | `landscape-v7` |
| 5 | `src/apps/depth.ts` | `depth-v2` |
| 6 | `src/apps/map.ts` | `research-map-v4` |
| 7 | `src/site/me.ts`, `src/site/public.ts`, `src/site/keys.ts` | |
| 8 | `docs/` | |

## 2. What changed from the first A10 spec

Reading the four views closely showed that three things in the first version would not work or carried needless risk.

| First version | Now | Why |
| --- | --- | --- |
| `UC.start()` takes over each view's handshake | **The views keep their own handshake, message listener and `request` function, untouched.** The shell is added beside them and has its own transport | The handshake is the part with a history of hanging in the Claude app with no cause found. The four views do it in three slightly different ways that all work. Nothing is gained by replacing them |
| On the site, `host.js` answers `get_topic`, `get_item` and `get_paper` so panels work there too | **No panels on the site, and `host.js` is not changed.** A click there opens the page, as today | `/t/<slug>.json` is not the shape `get_topic` returns, so the host would have to rebuild it. And the site has the real page one click away |
| `tell()` sends a text and a structure | **Text only**, with the lens, window and area in the first line | The views send only `content` today and that is known to work in the Claude app |
| The lens and window choosers move into the shell's bar | **They stay where each view has them** | They are different in each view (the Research map's lens is a row of buttons over a bit mask). Moving them is all risk |
| The Landscape and Depth chart selections move to the shell | **They keep their own *Pick topics* mode and Ask button**; only *telling the model* goes through the shell | Their questions are their own ("why are they where they are in the depth chart?") and picking a bubble is not a tick box |
| Size: under 14 KB | **About 22 KB** (the test caps it at 24 KB) | Three panel renderers in plain DOM calls cost that. The Landscape ends near 71 KB; check it in the Claude app before going on (step 4) |
| Every public tool echoes `state` | Only `get_topic` gains `lens`, echoed as `lens` | The others already return their lens, window and area, and `state` is already the name of a topic's state |

## 3. Rules for whoever builds it

Read these before step 1. Each comes from something that went wrong before.

1. **Do not touch the handshake.** In every view, leave these exactly as they are: the last line
   (`send({ id: 1, method: 'ui/initialize', … })`), the `window.addEventListener('message', …)` block except for the lines this spec
   adds, and the functions `send`, `request`, `reportSize` (or `size`), `readResult`, `setTheme`.
2. **No SDK, no bundler, no `import` inside a view's script, no `type="module"`.** A view is one HTML page with one classic inline
   `<script>`. The shell is put into that script as text.
3. **Do not edit `src/apps/costs.ts`, `signal.ts`, `galaxy.ts` or `first.ts`.**
4. **Inside a view file you are inside a template literal.** So in the view's own code a backslash is written twice (`'\\u2026'`,
   `/\\s+/`), and a backtick or `${` ends the page. The only two placeholders a view may have are the ones this spec adds:
   `${SHELL_CSS}` and `${SHELL_JS}`. Where this spec gives code to add to a view, it avoids backslashes on purpose; keep it that way.
5. **`shell.ts` is the opposite: it uses `String.raw`**, so a backslash is written once. Copy it as given.
6. **Never set `innerHTML` with text that came from a tool.** Use `textContent` (the helper `mk` in the views, `h` in the shell). The
   Research map uses `innerHTML` with its own `esc()`; do not add new uses.
7. **Bump the view's address when its file changes** (the constants at the top of `src/agentMcp.ts`), once per step.
8. **Run `npm run check` after every step** and do not go on while it fails.
9. **A view that passes its tests can still hang in the Claude app.** The owner deploys and checks there
   ([section 13](#13-checking-a-view-by-hand)). If the Topic hub (step 3) does not render in the Claude app, stop: do not do steps
   4 to 6 until that is understood.
10. **If the code in a view does not match what a step says to find, stop and report it.** Do not guess a nearby place.

## 4. The four views today

What each one has, so the edits below make sense. All four are in `src/apps/`, each `export default` a page as one template literal.

| | Topic hub `topichub.ts` | Landscape `landscape.ts` | Depth chart `depth.ts` | Research map `map.ts` |
| --- | --- | --- | --- | --- |
| Tool | `get_topic` | `get_overview` | `get_rising` | `get_papers`, then `get_research_map` |
| Also on the site | no | yes (`/`) | yes (`/rising`) | yes (`/research/map`) |
| Root element | `#app` | `#app` | `#app` | `#app` (holds `#s` and `#main`) |
| Data variable | `D` | `D`, and `L = D.landscape` | `D` | `d` |
| Request helper | `request(method, params, ms, done)` | same | same | none: `pending[id] = fn` and `send` |
| Size report | `reportSize()` | `reportSize()` | `reportSize()` | `size()` |
| Message line | `#msg` | `#note` | `#note` | none |
| Click on a topic | related chip → `go(slug, true)` | `act(b)` | `act(t)` | none |
| Own selection | `sel`, ticks, `#ask` | `sel` in *Pick topics* mode, `pins` in the Ladder, `#ask` | `sel` in *Pick topics* mode, `#ask` | none |
| Tells the model | `sendContext()` | `sendContext()` | `sendContext()` | never |
| Back | own `trail` and `#back` | none | none | none |
| *Open on the site* | own `#site` | none | none | a link in an error text only |
| CSS variables | `--bg --fg --mut --line --ac --btn --card` | no `--card` | no `--card` | no `--btn` |

The site's host (`HOST_JS` in `src/site/viz.ts`) answers the handshake with `hostCapabilities: { openLinks: {} }`. The Claude app
lists `message` and more. That difference is how the shell knows where it is: **a host that lists capabilities and has no `message`
is the site**, and gets no panels, no telling and no asking. A host that lists nothing gets everything, as the views do today.

## 5. Step 1: the shell and its test

Create the two files below exactly. Nothing includes the shell yet, so no view changes in this step.

### What `UC` offers

| Call | Does |
| --- | --- |
| `UC.init(opts)` | Once, in the view's handshake branch. Builds the bar, the panel box, the question box and the foot bar inside `opts.root`. Calling it again only replaces `opts` |
| `UC.open(kind, args)` | Opens a panel: `'topic'` `{ topic, area }`, `'item'` `{ topic, item, area }`, `'paper'` `{ id }`. Returns `false` and does nothing where panels are off (the site), so the caller can fall back |
| `UC.swap(kind, args)` | Replaces the top panel (the next item in time), so Back still goes to the list |
| `UC.step(title, undo)` | Records a move the view drew itself (the Topic hub going to a related topic). Back calls `undo` |
| `UC.back()`, `UC.reset()`, `UC.depth()` | Back one, drop the whole stack, how deep it is |
| `UC.pick(key, desc)`, `UC.picked(key)`, `UC.chosen()` | Selection. `desc` is `{ k: 'item' \| 'paper' \| 'topic', label, url, id?, slug?, meta?, t? }`; `null` unpicks. `t` is the topic address an item or paper was picked in, needed for *Save to a list* |
| `UC.tell()` | Tells the model, after 600 ms of quiet, and only when the text changed |
| `UC.ask(text)` | Sends a chat message |
| `UC.suggest(list)` | Draws up to three question buttons under the view |
| `UC.link(url)` | Opens a link through the host |
| `UC.refresh()` | Redraws the bar and the foot (call it after the view has new data) |
| `UC.call(tool, args, done)`, `UC.rpc`, `UC.read`, `UC.can` | The transport, for a view that wants it |

`opts`:

| Field | Type | Meaning |
| --- | --- | --- |
| `title` | string, or a function returning one | The first part of the trail |
| `host` | object | `hostCapabilities` from the handshake |
| `root` | element | The view's `#app` |
| `size` | function | The view's own size report |
| `note` | function(text) | Where a short message is shown (`#msg`, `#note`); may be left out |
| `site` | function → string | The address of this view on the site, with its present filters; `''` when unknown |
| `context` | function → string | What the view itself wants the model to know (its present `contextText()`) |
| `state` | function → `{ area, lens, window }` | For the first line told to the model, and for *Open the full view* |
| `redraw` | function | Called when the last panel closes, so a picture drawn while hidden is drawn again |
| `cleared` | function | Called after *Clear* in the foot bar, so the view can untick its boxes |
| `question` | function(picks) → string | The question *Ask Claude about these* asks; a general one when left out |
| `saveBase` | function → string | `https://<site>/me/save`, or `''` to hide *Save to a list* |

How it sits in the page: the shell puts `#ucbar` and `#ucp` (the panel) at the top of the root and `#ucq` and `#ucfoot` at its
end. While a panel is open the root has the class `ucon`, and one CSS rule hides everything else in the root. The view's own size
report measures the root, so it keeps working without a change.

### `src/apps/shell.ts`

```ts
// The shell of the public views (A10 in docs/SPEC-A10-shell.md): the bar with Back and the trail, panels for a topic, an item and a paper, picking, telling the model, asking, suggested questions.
// Two strings that a view puts into its own page: SHELL_CSS inside its <style>, SHELL_JS at the top of its one <script>. No SDK, no bundler; the view stays one self-contained page.
// String.raw: what is written here is exactly what the browser gets, so a backslash is written once. Never write a backtick, a dollar sign followed by a brace, or a script tag in either string.
// SHELL_JS defines one global, UC. It has its own transport (message ids from 100001), so a view's own request ids never meet it.
export const SHELL_CSS = String.raw`#ucbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 8px;font-size:12.5px;color:var(--mut)}#ucbar .ucsp{flex:1}
.uctrail{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.ucon>:not(#ucbar):not(#ucp):not(#ucfoot){display:none!important}
#ucp{max-width:46rem}#ucp h2{margin:0 0 4px;font-size:19px;line-height:1.25}#ucp h2:focus{outline:none}#ucp h3{margin:14px 0 4px;font-size:13.5px;color:var(--mut);font-weight:600}#ucp p{margin:4px 0}
.ucstate{display:inline-block;border:1.5px solid var(--ac);color:var(--ac);border-radius:99px;padding:0 9px;font-size:12.5px;font-weight:600;margin-left:8px;vertical-align:3px}
.ucsum{max-width:46rem}.ucm{color:var(--mut);font-size:12.5px}
.ucev{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:8px 0 2px}.ucseg{border:1px solid var(--line);border-radius:9px;padding:7px 10px;background:var(--card,transparent)}.ucseg b,.ucseg span{display:block}.ucseg span{color:var(--mut);font-size:12.5px}
.ucacts,.ucchips,.ucq{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.ucacts{margin:8px 0}.ucq{margin-top:12px}
.ucrow{display:grid;grid-template-columns:22px minmax(0,1fr);gap:6px;padding:7px 0;border-top:1px solid var(--line)}.ucrow input{margin:3px 0 0;width:16px;height:16px;accent-color:var(--ac)}
.uck{color:var(--ac);font-size:12px;font-weight:600;margin-right:6px}
#ucbar button,#ucp button,#ucfoot button,#ucq button{font:inherit;color:var(--fg);background:var(--btn,transparent);border:1px solid var(--line);border-radius:7px;padding:3px 10px;cursor:pointer}
#ucp button.uclk,#ucp button.ucmb{background:none;border:0;padding:0;text-align:left;text-decoration:underline;text-decoration-color:var(--line);text-underline-offset:2px}#ucp button.uclk{font-weight:500}#ucp button.ucmb{color:var(--mut);font-size:12.5px}
#ucp button.uclk:hover,#ucp button.ucmb:hover{color:var(--ac)}#ucp button.ucnear{display:block;margin:4px 0}
#ucp button.ucchip,#ucq button.ucchip{border-radius:99px}
#ucfoot{position:sticky;bottom:0;display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px;padding:8px 0;border-top:1px solid var(--line);background:var(--bg)}
#ucbar button:focus-visible,#ucp button:focus-visible,#ucfoot button:focus-visible,#ucq button:focus-visible,#ucp input:focus-visible{outline:2px solid var(--ac);outline-offset:2px}`;

export const SHELL_JS = String.raw`// ---- the shell (src/apps/shell.ts): what every public view shares. One global, UC. Own transport: its message ids start at 100000, so they never meet a view's own.
var UC = (function () {
  var o = null, host = {}, pend = {}, seq = 100000, stack = [], picks = {}, gen = 0, tellTimer = 0, lastTold = '', root = null, bar = null, pane = null, foot = null, qbox = null, opener = null;
  var KIND = { x: 'X', hn: 'HN', youtube: 'YouTube', rss: 'Blog', arxiv: 'Paper' };
  var STATE = { 'new': 'New', rising: 'Rising', steady: 'Steady', falling: 'Falling' };
  function h(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function btn(text, cls, fn) { var b = h('button', cls || '', text); b.type = 'button'; b.onclick = fn; return b; }
  function post(m) { m.jsonrpc = '2.0'; parent.postMessage(m, '*'); }
  function rpc(method, params, ms, done) {
    var id = ++seq, timer = setTimeout(function () { delete pend[id]; done(new Error('no reply from the host')); }, ms || 20000);
    pend[id] = function (m) { clearTimeout(timer); done(m.error ? new Error(m.error.message || 'error') : null, m.result); };
    post({ id: id, method: method, params: params });
  }
  window.addEventListener('message', function (e) { var m = e.data, fn; if (!m || !m.id || !pend[m.id]) return; fn = pend[m.id]; delete pend[m.id]; fn(m); });
  // What a tool answered: the data when there is any, and whether it was an error answer (an item that has left its topic is one, and still carries data).
  function read(res) {
    var d = null, text = res && res.content && res.content[0] ? String(res.content[0].text || '') : '';
    if (res && res.structuredContent) d = res.structuredContent; else { try { d = JSON.parse(text); } catch (x) { d = null; } }
    return { ok: !!res && !res.isError && !!d, data: d, text: text };
  }
  function call(tool, args, done) { rpc('tools/call', { name: tool, arguments: args }, 30000, function (err, res) { if (err) done(err); else done(null, read(res)); }); }
  function listed() { return Object.keys(host).length > 0; }
  var can = {
    message: function () { return !!host.message || !listed(); },
    context: function () { return !!host.updateModelContext || !!host.message || !listed(); },
    panels: function () { return !!host.message || !!host.serverTools || !listed(); }   // the site's host lists only openLinks: no panels there, the pages are a click away
  };
  function link(url) { rpc('ui/open-link', { url: url }, 8000, function (err) { if (err) say('This host did not open the link. It is at ' + url); }); }
  function say(text) { if (o && o.note) o.note(text); }
  function top() { return stack.length ? stack[stack.length - 1] : null; }
  function size() { if (o && o.size) o.size(); }

  // ---- the bar: Back, the trail, Open on the site
  function trail() { return [typeof o.title === 'function' ? o.title() : o.title].concat(stack.map(function (s) { return s.title; })); }
  function siteUrl() { var t = top(); if (t && t.kind !== 'step') return t.url || ''; return o.site ? o.site() : ''; }
  function renderBar() {
    if (!bar) return;
    bar.textContent = '';
    if (stack.length) bar.appendChild(btn('← Back', 'ucback', back));
    var t = h('span', 'uctrail'); t.setAttribute('aria-label', 'Where you are'); t.textContent = trail().join(' › '); bar.appendChild(t);
    bar.appendChild(h('span', 'ucsp'));
    var u = can.panels() ? siteUrl() : ''; if (u) bar.appendChild(btn('Open on the site', '', function () { link(siteUrl()); }));
    bar.classList.toggle('hide', !stack.length && !u);
  }

  // ---- panels
  function row(body, key, desc) {
    var r = h('div', 'ucrow'), c = h('div');
    if (key && can.message()) { var t = h('input'); t.type = 'checkbox'; t.checked = !!picks[key]; t.setAttribute('aria-label', 'Pick ' + desc.label); t.onchange = function () { pick(key, t.checked ? desc : null); }; c.appendChild(t); }
    r.appendChild(c); r.appendChild(body); return r;
  }
  function meta(parts) { return h('div', 'ucm', parts.filter(Boolean).join(' · ')); }
  function section(p, title) { p.appendChild(h('h3', '', title)); }
  function drawTopic(p, d) {
    var st = d.state && STATE[d.state], hd = h('h2', '', d.label), a = d.area === 'politics' ? 'politics' : 'ai';
    hd.tabIndex = -1; if (st) hd.appendChild(h('span', 'ucstate', st)); p.appendChild(hd);
    p.appendChild(h('p', 'ucsum', d.summary ? d.summary.text : d.fallback || ''));
    p.appendChild(h('p', 'ucm', d.summary ? 'Written by an AI on ' + d.summary.day + ' from ' + d.summary.itemCount + ' items.' : 'No written summary yet; the line above is built from the numbers.'));
    var ev = h('div', 'ucev'); (d.evidence || []).forEach(function (e) { var s = h('div', 'ucseg'); s.appendChild(h('b', '', e.label)); (e.lines || []).forEach(function (l) { s.appendChild(h('span', '', l)); }); ev.appendChild(s); });
    if (ev.childNodes.length) { p.appendChild(ev); p.appendChild(h('p', 'ucm', 'Each source counts in its own unit, so the numbers are never added together.')); }
    var acts = h('div', 'ucacts');
    if (can.message()) acts.appendChild(btn('Open the full view', '', function () { ask('Show me the topic ' + d.slug + ' (' + d.label + ') in Undercurrent' + stateWords() + '.'); }));
    p.appendChild(acts);
    var talk = (d.talk || []).slice(0, 6);
    if (d.sourcesShown === false) p.appendChild(h('p', 'ucm', 'This topic’s Signal does not show its sources, so the items behind it are not public.'));
    else if (talk.length) {
      section(p, 'What is being said');
      talk.forEach(function (i) {
        var b = h('div'), m;
        b.appendChild(h('span', 'uck', KIND[i.kind] || i.kind)); b.appendChild(btn(i.title || i.url, 'uclk', function () { link(i.url); }));
        m = meta([i.by, i.kind !== 'x' ? i.source : '', i.reactionsText]);
        if (i.id) { m.appendChild(document.createTextNode(' · ')); m.appendChild(btn('In context', 'ucmb', function () { open('item', { topic: d.slug, item: i.id, area: a }); })); }
        b.appendChild(m); p.appendChild(row(b, 'item:' + i.url, { k: 'item', label: i.title || i.url, url: i.url, t: d.slug, meta: [i.by, i.source].filter(Boolean).join(', ') }));
      });
    }
    var pl = d.papers && d.papers.list ? d.papers.list.slice(0, 4) : [];
    if (pl.length) {
      section(p, 'Papers');
      pl.forEach(function (q) { var b = h('div'); b.appendChild(btn(q.title, 'uclk', function () { open('paper', { id: q.id }); })); b.appendChild(meta([q.id, q.uptake && q.uptake.discussed ? 'being discussed' : 'not discussed yet'])); p.appendChild(row(b, 'paper:' + q.id, { k: 'paper', label: q.title, id: q.id, url: q.url, t: d.slug })); });
      if (d.papers.thanks) p.appendChild(h('p', 'ucm ucthanks', d.papers.thanks));
    }
    var br = (d.briefings || []).slice(0, 3);
    if (br.length) { section(p, 'In briefings'); br.forEach(function (x) { var b = h('div'); b.appendChild(btn(x.title + (x.theme ? ': ' + x.theme : ''), 'uclk', function () { link(x.url); })); p.appendChild(row(b)); }); }
    var rel = (d.related || []).slice(0, 8);
    if (rel.length) { section(p, 'Talked about together with'); var ch = h('div', 'ucchips'); rel.forEach(function (r) { ch.appendChild(btn(r.label, 'ucchip', function () { open('topic', { topic: r.slug, area: a }); })); }); p.appendChild(ch); }
    suggest(d.questions, p);
  }
  function near(p, label, n, d) { if (n) p.appendChild(btn(label + ': ' + (n.title || n.id), 'uclk ucnear', function () { swap('item', { topic: d.topic.slug, item: n.id, area: top().args.area }); })); }
  function drawItem(p, d) {
    if (d && d.gone) { var g = h('h2', '', 'This item has left the topic'); g.tabIndex = -1; p.appendChild(g); p.appendChild(h('p', 'ucm', 'It is older than the two weeks kept for a topic, or the topic has moved on.')); if (d.url) p.appendChild(btn('Open the original', '', function () { link(d.url); })); return; }
    var hd = h('h2', '', d.title || d.original); hd.tabIndex = -1; p.appendChild(hd);
    p.appendChild(meta([KIND[d.kind] || d.kind, d.by, d.source !== d.by ? d.source : '', d.date]));
    p.appendChild(h('p', 'ucsum', d.reactionsText ? 'Reactions, in this source’s own unit: ' + d.reactionsText + '.' : 'No reaction counts for this item.'));
    var acts = h('div', 'ucacts'); acts.appendChild(btn('Open the original', '', function () { link(d.original); }));
    if (d.discussionUrl && d.discussionUrl !== d.original) acts.appendChild(btn('Thread', '', function () { link(d.discussionUrl); }));
    if (can.message()) acts.appendChild(btn('Ask Claude about this', '', function () { ask('About this item in ' + d.topic.label + ': "' + (d.title || '') + '" (' + d.original + '). What is it, and why does it matter here? (get_item with topic ' + d.topic.slug + ' and item ' + d.id + ' gives it in context.)'); }));
    p.appendChild(acts);
    section(p, 'Why it is here'); p.appendChild(h('p', '', d.why ? d.why.words : '')); p.appendChild(h('p', 'ucm', d.why ? d.why.placeWords : ''));
    if (d.copies !== null && d.copies !== undefined) { section(p, 'Said the same'); p.appendChild(h('p', '', d.copies ? d.copies + (d.copies === 1 ? ' later post saying nearly the same was' : ' later posts saying nearly the same were') + ' folded into this one.' : 'No later post saying the same was folded into this one.')); }
    section(p, 'Before and after'); near(p, 'Before', d.before, d); near(p, 'After', d.after, d);
    if (!d.before && !d.after) p.appendChild(h('p', 'ucm', 'Nothing else in this topic.'));
    if (d.alsoIn && d.alsoIn.length) { section(p, 'Also in'); var ch = h('div', 'ucchips'); d.alsoIn.forEach(function (t) { ch.appendChild(btn(t.label, 'ucchip', function () { open('topic', { topic: t.slug, area: top().args.area }); })); }); p.appendChild(ch); }
    p.appendChild(h('p', 'ucm', 'Posts and articles are written by others; follow a link to read the original.'));
  }
  function drawPaper(p, d) {
    var hd = h('h2', '', d.title), ms = (d.mentions || []).slice(0, 8), u = d.uptake || {}, up = [];
    hd.tabIndex = -1; p.appendChild(hd);
    p.appendChild(meta([d.id, d.date, (d.authors || []).slice(0, 3).join(', ') + ((d.authors || []).length > 3 ? ' et al.' : '')]));
    if (u.accounts) up.push('named in ' + u.accounts + (u.accounts === 1 ? ' post' : ' posts')); if (u.hn) up.push(u.hn.points + ' Hacker News points'); if (u.huggingFace) up.push(u.huggingFace.upvotes + ' Hugging Face upvotes');
    p.appendChild(h('p', 'ucm', up.length ? 'Being discussed: ' + up.join(', ') + '.' : 'Not discussed yet.'));
    p.appendChild(h('p', 'ucsum', d.abstract || ''));
    var acts = h('div', 'ucacts'); acts.appendChild(btn('Open the abstract page', '', function () { link(d.url); })); p.appendChild(acts);
    if (ms.length) { section(p, 'Posts that name it'); ms.forEach(function (m) { var b = h('div'); b.appendChild(btn('@' + String(m.by).replace(/^@/, ''), 'uclk', function () { link(m.url); })); p.appendChild(row(b)); }); }
    if (d.thanks) p.appendChild(h('p', 'ucm ucthanks', d.thanks));
  }
  var DRAW = { topic: drawTopic, item: drawItem, paper: drawPaper };
  var TOOL = { topic: 'get_topic', item: 'get_item', paper: 'get_paper' };
  function argsOf(kind, a) {
    if (kind === 'paper') return { id: a.id };
    var x = { topic: a.topic }; if (kind === 'item') x.item = a.item; if (a.area === 'politics') x.area = 'politics'; return x;
  }
  function render() {
    var t = top(), on = !!t && t.kind !== 'step';
    if (!root) return;
    root.classList.toggle('ucon', on); pane.classList.toggle('hide', !on); pane.textContent = '';
    if (on) {
      if (t.err) pane.appendChild(h('p', 'ucm', 'Could not read it: ' + t.err));
      else if (!t.data) pane.appendChild(h('p', 'ucm', 'Reading…'));
      else DRAW[t.kind](pane, t.data);
    }
    renderBar(); renderFoot();
    if (qbox) qbox.classList.toggle('hide', on);
    size();
  }
  function load(entry) {
    var g = ++gen;
    call(TOOL[entry.kind], argsOf(entry.kind, entry.args), function (err, r) {
      if (g !== gen || top() !== entry) return;   // the reader moved on meanwhile
      if (err) entry.err = err.message;
      else if (!r.ok && !(r.data && r.data.gone)) entry.err = r.text.slice(0, 200) || 'nothing came back';
      else { entry.data = r.data; entry.title = r.data.gone ? 'Item' : entry.kind === 'topic' ? r.data.label : entry.kind === 'paper' ? r.data.title : r.data.title || 'Item'; entry.title = String(entry.title).slice(0, 40); entry.url = entry.kind === 'paper' ? r.data.mapUrl || '' : r.data.gone ? '' : r.data.url || ''; }
      render(); var hd = pane.querySelector('h2'); if (hd && hd.focus) hd.focus();
      tell();
    });
  }
  function push(entry) { if (!stack.length) opener = document.activeElement; var t = top(); if (t) t.scroll = window.scrollY || 0; stack.push(entry); if (stack.length > 12) stack.splice(0, stack.length - 12); }
  function open(kind, args) {
    if (!o || !DRAW[kind] || !can.panels()) return false;
    var e = { kind: kind, args: args || {}, title: kind === 'topic' ? String(args.topic) : kind === 'paper' ? String(args.id) : 'Item', data: null, err: '', url: '', scroll: 0 };
    push(e); render(); load(e); return true;
  }
  function swap(kind, args) { if (!stack.length) return open(kind, args); stack.pop(); return open(kind, args); }
  // A step the view drew itself (the Topic hub moving to a related topic): Back calls undo.
  function step(title, undo) { push({ kind: 'step', title: String(title).slice(0, 40), undo: undo, scroll: 0 }); render(); tell(); }
  function back() {
    var e = stack.pop(), t; if (!e) return;
    gen++;
    if (e.kind === 'step' && e.undo) e.undo();
    render(); t = top();
    if (!t || t.kind === 'step') { if (o.redraw) o.redraw(); if (opener && opener.focus && !stack.length) { try { opener.focus(); } catch (x) {} } }
    else if (!t.data && !t.err) load(t);
    try { window.scrollTo(0, t ? t.scroll || 0 : 0); } catch (x) {}
    tell();
  }
  function reset() { stack = []; gen++; render(); }

  // ---- picking, telling the model, asking
  function pick(key, desc) { if (desc) picks[key] = desc; else delete picks[key]; var n = Object.keys(picks); if (n.length > 20) delete picks[n[0]]; renderFoot(); tell(); }
  function picked(key) { return !!picks[key]; }
  function chosen() { return Object.keys(picks).map(function (k) { return picks[k]; }); }
  function pickLine(d) {
    if (d.k === 'topic') return '- topic: ' + d.label + ' (address ' + d.slug + '; get_topic gives the summary)';
    if (d.k === 'paper') return '- paper: ' + d.label + ' (id ' + d.id + '; get_paper gives the abstract) ' + d.url;
    return '- ' + d.label + (d.meta ? ' (' + d.meta + ')' : '') + ' ' + d.url;
  }
  function stateWords() { var s = o.state ? o.state() : {}, b = []; if (s.lens) b.push('lens: ' + s.lens); if (s.window) b.push('window: ' + s.window); if (s.area === 'politics') b.push('area: politics'); return b.length ? ' (' + b.join(', ') + ')' : ''; }
  function contextText() {
    var t = top(), lines = ['Undercurrent. Looking at: ' + trail().join(' > ') + stateWords() + '.'], own = o.context ? o.context() : '', list = chosen();
    if (t && t.kind === 'topic') lines.push('Open panel: the topic ' + t.args.topic + (t.args.area === 'politics' ? ' (area politics)' : '') + '. get_topic gives it.');
    if (t && t.kind === 'item') lines.push('Open panel: one item (id ' + t.args.item + ') of the topic ' + t.args.topic + '. get_item gives it in context.');
    if (t && t.kind === 'paper') lines.push('Open panel: the paper ' + t.args.id + '. get_paper gives the abstract.');
    if (own) lines.push(own);
    if (list.length) lines.push('The user picked:\n' + list.map(pickLine).join('\n'));
    return lines.join('\n');
  }
  function tell() {
    if (!o || !can.context()) return;
    clearTimeout(tellTimer);
    tellTimer = setTimeout(function () { var text = contextText(); if (text === lastTold) return; lastTold = text; rpc('ui/update-model-context', { content: [{ type: 'text', text: text }] }, 8000, function () {}); }, 600);
  }
  function ask(text, done) {
    if (!can.message()) return;
    rpc('ui/message', { role: 'user', content: [{ type: 'text', text: text }] }, 10000, function (err, res) { var bad = !!err || !!(res && res.isError); say(bad ? 'Could not send that. Ask in the chat instead.' : 'Sent to Claude.'); if (done) done(!bad); });
  }
  function renderFoot() {
    if (!foot) return;
    var list = chosen(), n = list.length;
    foot.textContent = ''; foot.classList.toggle('hide', !n || !can.message());
    if (!n) return;
    foot.appendChild(h('span', '', n + ' picked'));
    foot.appendChild(btn('Ask Claude about these', '', function () { ask((o.question ? o.question(chosen()) : 'What do these say? Summarise what they agree and disagree on, and what I should read first.') + '\n\n' + contextText()); }));
    var items = list.filter(function (d) { return d.k !== 'topic' && d.url && d.t; }).slice(0, 10), base = o.saveBase ? o.saveBase() : '', pol = o.state && o.state().area === 'politics';
    if (items.length && base) foot.appendChild(btn('Save to a list', '', function () { link(base + '?' + items.map(function (d) { return 't=' + encodeURIComponent(d.t) + '&u=' + encodeURIComponent(d.url); }).join('&') + (pol ? '&area=politics' : '')); }));
    foot.appendChild(btn('Clear', '', function () { picks = {}; renderFoot(); tell(); render(); if (o.cleared) o.cleared(); }));
  }
  // ---- suggested questions: text from our own data, sent as a chat message
  function suggest(list, into) {
    var box = into ? h('div', 'ucq') : qbox, qs = (list || []).filter(function (q) { return typeof q === 'string' && q.length > 3 && q.length < 140; }).slice(0, 3);
    if (!box) return;
    if (!into) { box.textContent = ''; box.classList.toggle('hide', !qs.length || !can.message() || !!(top() && top().kind !== 'step')); }
    if (!qs.length || !can.message()) return;
    box.appendChild(h('span', 'ucm', 'Ask: '));
    qs.forEach(function (q) { box.appendChild(btn(q, 'ucchip', function () { ask(q + '\n\n' + contextText()); })); });
    if (into) into.appendChild(box); else size();
  }

  function init(opts) {
    o = opts; host = opts.host || {}; root = opts.root;
    if (!root || bar) { renderBar(); return; }   // called again after a second handshake: nothing to build twice
    bar = h('div', 'hide'); bar.id = 'ucbar'; pane = h('div', 'hide'); pane.id = 'ucp'; foot = h('div', 'hide'); foot.id = 'ucfoot'; qbox = h('div', 'ucq hide'); qbox.id = 'ucq';
    root.insertBefore(pane, root.firstChild); root.insertBefore(bar, pane); root.appendChild(qbox); root.appendChild(foot);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && stack.length && top().kind !== 'step') back(); });
    renderBar();
  }
  return { init: init, rpc: rpc, call: call, read: read, can: can, link: link, open: open, swap: swap, step: step, back: back, reset: reset, depth: function () { return stack.length; }, pick: pick, picked: picked, chosen: chosen, tell: tell, ask: ask, suggest: suggest, contextText: contextText, refresh: render };
})();
`;
```

### `test/shell.test.mjs`

```js
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
    button(b.part('ucq'), 'Why did').onclick(); assert.ok(b.of('ui/message')[0].params.content[0].text.startsWith('Why did X peak'));
  });
});

describe('hosts', () => {
  test('the site\'s host (only openLinks): no panel, nothing told, nothing asked, no bar', async () => {
    const b = boot({ openLinks: {} });
    assert.equal(b.UC.open('topic', { topic: 'x' }), false);
    b.UC.pick('a', { k: 'item', label: 'L', url: 'u' }); b.UC.tell(); b.UC.suggest(['Why did X peak on Tuesday?']); await later(700);
    assert.equal(b.sent.length, 0); assert.ok(b.part('ucbar').classList.contains('hide')); assert.ok(b.part('ucfoot').classList.contains('hide'));
  });
  test('a host that lists nothing gets everything, as the views have always done', () => {
    assert.equal(boot({}).UC.open('paper', { id: '2511.00001' }), true);
  });
});
```

### Done when

`npm run check` passes with 16 new tests. No other file changed.

## 6. Step 2: the server

Four small changes. None of them changes a view.

### 6.1 `src/site/questions.ts` (new, pure)

```ts
// Suggested questions under a view (A10): written by rule from the data, never by a model. At most three, in the order of the rules.
export const MAX_QUESTIONS = 3;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** A name as it may stand in a question: one line, no quotation marks, at most 60 letters. */
export const nameIn = (label: string): string => String(label ?? '').replace(/["“”]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
const weekday = (day: string): string | null => { const d = new Date(day + 'T12:00:00Z'); return Number.isNaN(d.getTime()) ? null : WEEKDAYS[d.getUTCDay()]; };

export interface TopicQ { label: string; state: string | null; phase: string | null; peakDay: string | null; /** The days of the series, oldest first. */ days: string[]; papers: number; /** The kinds of source in the order they had it, as titles. */ firstOrder: string[] }
export function topicQuestions(t: TopicQ): string[] {
  const n = nameIn(t.label), out: string[] = [];
  if (!n) return out;
  const recent = t.days.slice(-7), wd = t.peakDay && recent.includes(t.peakDay) ? weekday(t.peakDay) : null;
  if (wd && (t.phase === 'peaking' || t.phase === 'fading')) out.push(`Why did ${n} peak on ${wd}?`);
  if (t.papers > 0) out.push(`Which papers are behind ${n}?`);
  if (t.firstOrder.length >= 2) out.push(`How did ${n} get from ${t.firstOrder[0]} to ${t.firstOrder[1]}?`);
  if (t.state === 'new' || t.phase === 'emerging') out.push(`What is ${n}, in two sentences?`);
  if (t.phase === 'returning') out.push(`Why is ${n} back?`);
  return out.slice(0, MAX_QUESTIONS);
}
/** The overview: the topics that at least doubled, strongest first. */
export function overviewQuestions(rising: Array<{ label: string; change: number | null }>): string[] {
  return rising.filter((t) => (t.change ?? 0) >= 2 && nameIn(t.label)).sort((a, b) => (b.change ?? 0) - (a.change ?? 0)).slice(0, MAX_QUESTIONS).map((t) => `What is driving ${nameIn(t.label)} this week?`);
}
/** Rising from the deep: the steepest climbs that are not at the surface yet. */
export function risingQuestions(climbs: Array<{ label: string; zone: string | null }>): string[] {
  return climbs.filter((t) => t.zone !== 'surface' && nameIn(t.label)).slice(0, MAX_QUESTIONS).map((t) => `Who is talking about ${nameIn(t.label)} so far?`);
}
/** The research map: the clusters with most uptake. */
export function papersQuestions(clusters: Array<{ name: string; discussed: number }>): string[] {
  return clusters.filter((c) => c.discussed > 0 && nameIn(c.name)).sort((a, b) => b.discussed - a.discussed).slice(0, MAX_QUESTIONS).map((c) => `What are people saying about the ${nameIn(c.name)} papers?`);
}
```

### 6.2 `test/questions.test.mjs` (new)

In the style of `test/trail.test.mjs` (`node:test`, `node:assert/strict`, import from `../src/site/questions.ts`). Cases, one `test`
each:

| Case | Expect |
| --- | --- |
| A topic peaking, peak day in the last 7 days, with papers and two kinds in the first order | Three questions, in the order peak, papers, from-to; the peak one names the right weekday (`2026-11-10` is a Tuesday) |
| The same with the peak day 10 days back | No peak question |
| Phase `steady`, a peak day in range | No peak question |
| State `new`, nothing else | `['What is X, in two sentences?']` |
| Phase `returning` | Contains `'Why is X back?'` |
| Every rule true | Exactly 3 |
| A label with quotation marks, a line break and 100 letters | No quotation mark, no line break, name at most 60 letters |
| An empty label | `[]` |
| `overviewQuestions` with changes 3, 1.9, null, 2 | Two questions, the ×3 topic first |
| `risingQuestions` with zones `deep`, `surface`, `mid` | Two questions, none for the surface topic |
| `papersQuestions` with `discussed` 0, 4, 2 | Two questions, the 4 first |

### 6.3 `src/site/agentText.ts`

Import the four functions. Add **one field, `questions`**, to the `data` of four answers. Do not change any text.

1. **`topicOut`**: add a last optional parameter `lens?: string`. In `data` add:

   ```ts
   lens: lens ?? null,
   questions: topicQuestions({ label: t.label, state: t.state, phase: life?.phase ?? null, peakDay: life ? t.series.days[life.peak] ?? null : null, days: t.series.days, papers: t.papers.matched, firstOrder: t.first.arrivals.map((a) => KIND_TITLE[a.kind]) }),
   ```

   (`life` and `KIND_TITLE` are already in that function and file.)
2. **`overviewOut`**: add `questions: overviewQuestions(<the rising topics>)`. The function already builds the list it prints under
   new and rising topics; pass that list mapped to `{ label, change }`. If no single list has both fields, build it from the topics
   of `OverviewIn` whose state is rising.
3. **`risingOut`** (in `src/site/rising.ts`): add `questions: risingQuestions(climbs(d).map((t) => ({ label: t.label, zone: t.zone ?? null })))`.
   `climbs` is exported from the same file.
4. **`papersOut`**: add `questions: papersQuestions(r.clusters ?? [])`.

In `test/agenttext.test.mjs` add one test: `topicOut(...)` for the fixture topic has `data.questions` as an array of at most three
strings, and `data.lens` is `null` without the parameter and the given key with it.

### 6.4 `src/agentMcp.ts`

1. `get_topic`: add to `inputSchema`

   ```ts
   lens: z.string().regex(/^[a-z][a-z0-9-]{1,19}$/).optional().describe('The lens you are reading in, if any. It changes nothing in the answer; the Topic hub view keeps it so that what it asks next stays in the same lens.'),
   ```

   add `lens` to the destructured arguments and to the object given to `run(...)` (it is the cache key), and pass it as the last
   argument of `topicOut`.
2. Do not change the `*_UI` constants in this step.

### Done when

`npm run check` passes. `get_topic` over `/agent/mcp` on a local `wrangler dev` returns `questions` and `lens` in
`structuredContent`, and its text is unchanged.

## 7. Step 3: the Topic hub

File `src/apps/topichub.ts`. Twelve edits, then the constant and the tests. Line numbers are those of commit `7aca61c`.

**Edit 1, the top of the file.** Add as the first line (above the comments):

```ts
import { SHELL_CSS, SHELL_JS } from './shell.ts';
```

In the comment on line 5 replace "Keep it free of backticks and template placeholders." with "Keep it free of backticks; the only
template placeholders are the shell's two (see shell.ts)."

**Edit 2, the two placeholders.** Change `<style>` (line 10) to:

```
<style>
${SHELL_CSS}
```

and `<script>` (line 54) to:

```
<script>
${SHELL_JS}
```

**Edit 3, the HTML.** In line 45 remove the two buttons `#back` and `#site`, leaving:

```html
<div id="top"><span class="sp"></span><button id="fs" class="hide">Fullscreen</button></div>
```

In line 52 remove the foot with the ask button, leaving only the message line:

```html
<p id="msg" aria-live="polite"></p>
```

**Edit 4, the variables** (line 58). Remove `sel = {}`, `ctxTimer = 0` and `trail = []` from the list, and add `home = ''`:

```js
var pending = {}, nextId = 2, host = {}, D = null, theme = '', tab = 'talk', busy = false, home = '';
```

**Edit 5, `header()`.** Delete its last two lines (the ones that toggle `site` and `back`).

**Edit 6, `renderTabs()`.** In the tab button's `onclick`, add `UC.tell();` at the end:

```js
b.onclick = function () { tab = t[0]; renderTabs(); renderPane(); UC.tell(); };
```

**Edit 7, `tick()`.** Replace the function with:

```js
function tick(key, desc) {
  var c = mk('input'); c.type = 'checkbox'; c.checked = UC.picked(key); c.setAttribute('aria-label', 'Pick ' + desc.label);
  c.onchange = function () { UC.pick(key, c.checked ? desc : null); };
  return c;
}
```

**Edit 8, `talkPane()`.** Three changes inside it:

- In the kind button's `onclick`, after `loadItems(true);` add `UC.tell();`. In the order select's `onchange`, the same.
- In the row's `cell(...)` call, add the topic to the description: `{ k: 'item', label: i.title || i.url, url: i.url, t: D.slug, meta: … }`.
- After the line that adds the *thread* button (the one starting `if (i.discussionUrl && …`), add:

  ```js
  if (i.id && UC.can.panels()) { m.appendChild(document.createTextNode(' \\u00B7 ')); var ic = mk('button', '', 'In context'); ic.onclick = function () { UC.open('item', { topic: D.slug, item: i.id, area: D.area }); }; m.appendChild(ic); }
  ```

**Edit 9, `papersPane()`.** In the `cell(...)` call add `t: D.slug` to the description. After
`m.appendChild(document.createTextNode(when(q.published) + …));` add:

```js
if (UC.can.panels()) { m.appendChild(document.createTextNode(' \\u00B7 ')); var ab = mk('button', '', 'Abstract'); ab.onclick = function () { UC.open('paper', { id: q.id }); }; m.appendChild(ab); }
```

**Edit 10, related topics and Back.** In `go()`, replace the line inside `try` with:

```js
try { if (err) throw err; var prev = D; show(readResult(res)); if (push && prev) { var ps = prev.slug; UC.step(D.label, function () { go(ps, false); }); } el('msg').textContent = ''; } catch (e) { el('msg').textContent = 'Could not open that topic: ' + e.message; }
```

Delete the two lines after `go()` that set `el('back').onclick` and `el('site').onclick`.

**Edit 11, picking and asking.** Delete the functions `chosen`, `line`, `contextText`, `renderAsk`, `sendContext` and the
`el('ask').onclick = …` block (the whole section headed `// ---- picking and asking`). Put this in its place:

```js
// ---- what the shell needs from this view
var TABNAME = { talk: 'Talk', first: 'Who said it first', papers: 'Papers', watch: 'Watch', briefings: 'Briefings' };
function contextText() {
  var t = 'In the topic hub for ' + D.label + ' (address ' + D.slug + (D.area === 'politics' ? ', area politics' : '') + '), on the ' + TABNAME[tab] + ' tab';
  if (tab === 'talk') t += (T.kind ? ', only ' + T.kind : '') + ', ' + (T.sort === 'top' ? 'most reacted first' : 'newest first');
  return t + '.';
}
function siteUrl() {
  var q = [];
  if (!D || !D.url) return '';
  if (tab !== 'talk') q.push('angle=' + tab);
  if (tab === 'talk' && T.kind) q.push('kind=' + T.kind);
  if (tab === 'talk' && T.sort === 'new') q.push('sort=newest');
  return D.url + (q.length ? (D.url.indexOf('?') >= 0 ? '&' : '?') + q.join('&') : '');
}
function origin() { return D && D.url ? D.url.split('/').slice(0, 3).join('/') : ''; }
```

(The site's Talk is ordered by most reacted unless `sort=newest` is given; the hub's default is newest, hence the last rule.)

**Edit 12, `show()` and the handshake.**

In `show()`: remove `renderAsk();` from the line `header(); renderTabs(); related(); renderAsk(); renderPane();`. Add at the very end
of the function:

```js
if (!home) home = D.label;
UC.suggest(D.questions); UC.refresh(); UC.tell();
```

In the message listener's `m.id === 1` branch, directly after `host = r.hostCapabilities || {};`, add:

```js
UC.init({ title: function () { return home || 'Topic'; }, host: host, root: el('app'), size: reportSize,
  note: function (t) { el('msg').textContent = t; }, site: siteUrl,
  context: function () { return D ? contextText() : ''; },
  state: function () { return D ? { area: D.area, lens: D.lens || '', window: D.window ? D.window.days : 0 } : {}; },
  redraw: function () { if (D) renderPane(); },
  cleared: function () { if (D) { renderPane(); related(); } },
  question: function () { return 'What do these say about ' + D.label + '? Summarise what they agree and disagree on, and what I should read first.'; },
  saveBase: function () { return origin() ? origin() + '/me/save' : ''; } });
```

In the same branch change `if (D) { renderAsk(); renderPane(); related(); }` to `if (D) { renderPane(); related(); }`.

`related()` needs no edit: its `tick('topic:' + r.slug, …)` now goes through the new `tick()`, and a topic is not something to save,
so its description gets no `t`.

**After the edits**, search the file for `sel[`, `trail`, `renderAsk`, `sendContext`, `el('back')`, `el('site')`, `el('ask')`: there
must be no match left.

**The constant.** In `src/agentMcp.ts`: `TOPIC_UI = 'ui://undercurrent/topic-v4.html'`.

**The tests.** `test/hubviews.test.mjs`: the test *the hub asks only for what the server offers* still passes unchanged (the shell
names its tools through a variable). Add to that file:

```js
it('the hub uses the shell for Back, picks and telling the model', () => {
  const s = script(hub);
  for (const call of ['UC.init(', 'UC.step(', 'UC.pick(', 'UC.tell()', "UC.open('item'", "UC.open('paper'"]) assert.ok(s.includes(call), call);
  assert.doesNotMatch(hub, /id="back"|id="site"|id="ask"/);
});
```

### Done when

- `npm run check` passes.
- In the fake host ([section 13](#13-checking-a-view-by-hand)) with capabilities `{ message: {}, updateModelContext: {} }`: the hub
  draws; a related topic switches and the bar shows `First › Second` with Back; *In context* opens an item panel and Back returns
  to the list; ticking two items shows the foot bar; a tab change sends one `ui/update-model-context` whose text starts
  `Undercurrent. Looking at:`; the questions show under the view.
- **In the Claude app** (the owner, after a deploy, connector reconnected, new chat): "show me the topic X" draws the hub. If it
  stays at "rendering widget", stop here.

## 8. Step 4: the Landscape

File `src/apps/landscape.ts`. Six edits.

**Edit 1 and 2.** The import and the two placeholders, exactly as for the Topic hub (the `<style>` is on line 12, the `<script>` on
line 61). Update the header comment's sentence about placeholders the same way if it has one.

**Edit 3, `act(b)`.** Replace the whole `if (host.message) { … return; }` block (from the comment line "A view cannot swap itself…"
down to its closing `return; }`) with:

```js
// In a host that can run this server's tools the topic opens in place, as a panel of the shell, and Back returns to the map. On the site the shell declines and the page opens, as before.
if (UC.open('topic', { topic: b.slug, area: area })) { hideTip(); return; }
```

The line `openPage(b);` after it stays. The picking branch above it stays.

**Edit 4, `sendContext()`.** Replace its body so that it reads:

```js
function sendContext() { UC.tell(); }
```

and remove `ctxTimer = 0` from the `var` list on line 63. `contextText()`, `askClaude()`, `renderAsk()`, `#pickb` and `#ask` stay
exactly as they are: picking bubbles and pinning Ladder lines are this view's own.

**Edit 5, a site address.** Add next to `openPage`:

```js
function siteUrl() {
  var o = L && L.bubbles && L.bubbles[0] && L.bubbles[0].url ? L.bubbles[0].url.split('/').slice(0, 3).join('/') : '';
  if (!o) return '';
  return o + (area === 'politics' ? '/politics' : '/') + '?window=' + win + (lens ? '&lens=' + lens : '');
}
```

**Edit 6, `show()` and the handshake.** At the very end of `show(data)` (after `el('note').textContent = '';`) add:

```js
UC.suggest(D.questions); UC.refresh(); UC.tell();
```

In the message listener's `m.id === 1` branch, directly after `host = r.hostCapabilities || {};`, add:

```js
UC.init({ title: 'Landscape', host: host, root: el('app'), size: reportSize,
  note: function (t) { el('note').textContent = t; }, site: siteUrl,
  context: function () { return L ? contextText() : ''; },
  state: function () { return { area: area, lens: lens, window: win }; },
  redraw: function () { if (L) draw(); } });
```

**The constant.** `LANDSCAPE_UI = 'ui://undercurrent/landscape-v7.html'`.

**The tests.** In `test/hubviews.test.mjs` replace the test *the landscape asks Claude to show a topic where the host can message*
(its pattern no longer matches) with:

```js
it('the landscape opens a topic in place and falls back to the page', () => {
  const s = script(land);
  assert.match(s, /UC\.open\('topic'[\s\S]{0,120}return; \}[\s\S]{0,40}openPage\(b\)/);
  assert.ok(s.includes('Show me the topic'), 'the panel still offers the full view (it is in the shell)');
});
```

`test/viz.test.mjs` needs no change (it computes each view's hash from the page). Run it: the Landscape is also a site frame.

### Done when

- `npm run check` passes.
- Fake host as the Claude app: a bubble opens the topic panel; *In context* on an item, then Back, Back: the map is as it was (same
  lens, same window, not blank). Changing the window sends one context text naming the window. *Pick topics* still works and its
  own Ask button still sends the same question as before.
- Fake host as the site (`hostCapabilities: { openLinks: {} }`): a bubble sends `ui/open-link` with the topic's address; no bar, no
  foot, no questions; nothing but `ui/open-link` and size reports is sent.
- On the site (local `wrangler dev`): the landing page's landscape looks and behaves as before, also in the dark masthead.
- **In the Claude app:** the Landscape draws. It is now the largest view (about 71 KB). If it does not render, the shell's size is
  the first suspect: report it; do not trim code by guessing.

## 9. Step 5: the Depth chart

File `src/apps/depth.ts`. The same six edits as the Landscape, with these differences.

- **Edit 1 and 2:** `<style>` is on line 10, `<script>` on line 58.
- **Edit 3, `act(t)`:** replace the `if (host.message) { … return; }` block with

  ```js
  if (UC.open('topic', { topic: t.slug, area: area })) { hideTip(); return; }
  ```

  `openPage(t);` after it stays.
- **Edit 4, `sendContext()`:** `function sendContext() { UC.tell(); }` and remove `ctxTimer = 0` from the `var` list on line 60.
  (The old function returned early without `host.message`; the shell makes that check.)
- **Edit 5:**

  ```js
  function siteUrl() {
    var o = D && D.topics && D.topics[0] && D.topics[0].url ? D.topics[0].url.split('/').slice(0, 3).join('/') : '', q = [];
    if (!o) return '';
    if (lens) q.push('lens=' + lens);
    if (area === 'politics') q.push('area=politics');
    return o + '/rising' + (q.length ? '?' + q.join('&') : '');
  }
  ```

- **Edit 6:** at the end of `show(d)`: `UC.suggest(D.questions); UC.refresh(); UC.tell();`. In the handshake branch after
  `host = r.hostCapabilities || {};`:

  ```js
  UC.init({ title: 'Rising from the deep', host: host, root: el('app'), size: reportSize,
    note: function (t) { el('note').textContent = t; }, site: siteUrl,
    context: function () { return D ? contextText() : ''; },
    state: function () { return { area: area, lens: lens, window: 0 }; },
    redraw: function () { if (D && !playing) draw(); } });
  ```

- **One more line:** a panel must not open over a running animation. In `act(t)`, make the new line
  `if (UC.can.panels()) stop();` followed by the `UC.open` line.

**The constant.** `DEPTH_UI = 'ui://undercurrent/depth-v2.html'`.

**The tests.** Add `depth` to the list of views in the first loop of `test/hubviews.test.mjs` (import
`depth from '../src/apps/depth.ts'`, entry `['depth chart', depth]`), and one test like the Landscape's with `openPage\(t\)`.

### Done when

As for the Landscape: `npm run check`; in the fake host a bubble opens the topic panel and Back returns to the same day of the
slider; as the site, a bubble opens the page and nothing else is sent; `/rising` on a local `wrangler dev` is unchanged.

## 10. Step 6: the Research map

File `src/apps/map.ts`. This view is built differently (it has no `request` helper and draws with `innerHTML`), so it gets the
smallest change: the bar, telling the model, and questions. **No panels**: it already opens an abstract in place.

**Edit 1 and 2.** The import and the two placeholders (`<style>` on line 11, `<script>` on line 55).

**Edit 2b, the variables** (line 57). Add `host = {}` and `asked = null`:

```js
var ready = false, scope = null, siteUrl = '', host = {}, asked = null;
```

**Edit 3, what the model is told.** Add after `dayText`:

```js
function mapContext() {
  var b = [];
  if (!d) return '';
  b.push('dates ' + dayText(S.from) + ' to ' + dayText(S.to));
  if (S.q) b.push('searching for "' + String(S.q).slice(0, 80) + '"');
  if (S.talk) b.push('only papers being discussed');
  if (S.att) b.push('only papers getting attention');
  if (S.lens >= 0 && d.lenses && d.lenses[S.lens]) b.push('lens ' + d.lenses[S.lens].name);
  return 'In the Undercurrent research map (papers of the last 30 days, abstracts only): ' + b.join(', ') + '. get_papers lists papers; get_paper gives an abstract.';
}
```

Before using `d.lenses[S.lens].name`, check in `setup()` or `draw()` how the lens buttons read their names and use the same field.
If the lenses are not at `d.lenses`, use what the file uses.

**Edit 4, tell on every change.** `draw()` is called after every filter change. Add as its last line:

```js
UC.tell();
```

(The shell waits 600 ms and sends nothing when the text is the same, so dragging a slider sends one message.)

**Edit 5, `take()`.** In the branch that handles the answer of `get_papers` (the one that sets `scope = sc.scope;`), add
`asked = sc.questions || null;`. After the two lines `d = v; setup();` near the end add:

```js
UC.suggest(asked); UC.refresh();
```

**Edit 6, the handshake.** Replace the line that starts `if (m.id === 1) {` with:

```js
if (m.id === 1) {
  host = (m.result && m.result.hostCapabilities) || {};
  UC.init({ title: 'Research map', host: host, root: el('app'), size: size, site: function () { return siteUrl; }, context: mapContext, state: function () { return {}; }, redraw: draw });
  applyTheme(m.result && m.result.hostContext && m.result.hostContext.theme); send({ method: 'ui/notifications/initialized' }); ready = true; size(); return;
}
```

Everything after `UC.init(…)` on that line is the old line, unchanged and in the same order.

Note the listener's first line, `if (e.source !== parent || !e.data) return;`: it is the map's own and stays. The shell has its own
listener.

**The constant.** `MAP_UI = 'ui://undercurrent/research-map-v4.html'`.

**The tests.** `test/hubviews.test.mjs`: add to the map's test `assert.ok(s.includes('UC.init(')); assert.ok(s.includes('UC.tell()'));`.

### Done when

`npm run check`; in the fake host the map draws, typing in the search box sends one context text after the typing stops, and the
bar shows *Open on the site*; as the site (`/research/map` on a local `wrangler dev`) it is unchanged and sends nothing new.

## 11. Step 7: the site

Two additions. Before writing either, read `src/site/me.ts` (how a request is known to be a signed-in reader, how the *☆ Save* form
on a topic page is built and what `POST /me/save` expects) and the part of `src/site/public.ts` that draws the topic page's action
row. Follow what is there; the names below are for the new parts only.

### 11.1 `GET /me/save`: the page *Save to a list* opens

The foot bar of a view opens `https://<site>/me/save?t=<slug>&u=<url>&t=<slug>&u=<url>…[&area=politics]`: pairs of a topic address
and an item's address, at most ten.

- **Who:** a signed-in reader, by the same check as `/me`. Signed out: whatever `/me` does for a signed-out visitor (the login),
  returning to this address.
- **Reading the address:** take the `t` and `u` values in order and pair them by position; ignore anything after the tenth pair.
  A `t` must match `TOPIC_SLUG`; a `u` must start with `https://` and be at most 500 letters; a pair that fails is dropped.
- **For each pair:** load the topic once per distinct slug (`loadTopic(env, slug, { quiet: true, area })`) and look the item up with
  `findItem(data, url)` from `src/users/model.ts`, the same function saving uses today.
  - Found: a row with the item's kind, title, source and date, and **the same save form the topic page shows for that item**
    (the list chooser and the Save button, posting to the existing `POST /me/save`, unchanged).
  - Not found: a row "No longer in this topic" with the address as plain text. No form.
- **Nothing from the address is stored.** The form carries what the topic page's form carries, and the POST reads the item from the
  topic's own data, as it does today. This page only chooses which forms to show.
- **Page:** title "Save to a list", the top bar, the rows, a link back to `/me`. Headers `Cache-Control: private, no-store`;
  `<meta name="robots" content="noindex">`. With no valid pair: "Nothing to save. Pick items in a view first."
- **Route:** beside the other `/me` routes. `GET /me/save` is new; `POST /me/save` exists and is not changed.
- **Pure part and its test:** `savePairs(params: URLSearchParams): Array<{ slug: string; url: string }>` in `src/users/model.ts`,
  tested in `test/users.test.mjs`: pairing by position, the cap of ten, a bad slug or a non-https address dropped, more `t` than `u`.

### 11.2 *Open in Claude* on four pages

A small `<details>` in the action row. Add one helper to `src/site/public.ts`:

```ts
/** A line to copy into Claude, for a page that has an MCP view. The sentence is ours; the name in it is escaped like any text. */
const openInClaude = (sentence: string): string =>
  `<details class="oic"><summary>Open in Claude</summary><p><span data-copy>${esc(sentence)}</span></p><p class="meta">Paste it into a chat that has the Undercurrent connector. <a href="/agent">How to add it</a>.</p></details>`;
```

(use the file's own HTML-escaping function where this writes `esc`). Where and what:

| Page | Sentence |
| --- | --- |
| `/t/<slug>` | `Show me the topic <label> in Undercurrent` + `, the <angle name> angle` when the angle is not Talk |
| `/` and `/politics`, by the landscape block | `Show me the Undercurrent landscape` + ` in the <lens name> lens` with a lens + `, politics` in that area |
| `/rising` | `Show me what is rising in Undercurrent` + the same lens words |
| `/research/map` | `Show me the Undercurrent research map` |

CSS, with the page's other small rules: `.oic{display:inline-block;font-size:13.5px}.oic summary{cursor:pointer;color:var(--muted)}.oic [data-copy]{user-select:all}`.

In `src/site/keys.ts` (the script `/viz/keys.js`): for every `[data-copy]` on the page, add a `<button type="button">Copy</button>`
after it that writes the element's text with `navigator.clipboard.writeText` inside `try/catch`, and shows "Copied" for two seconds.
Without script the text is selected in one click (`user-select: all`) and copied by hand.

The landing page must stay under 60 KB; this adds about 300 bytes.

### Done when

`npm run check`; signed in on a local `wrangler dev`, `/me/save?t=<a real slug>&u=<a real item address>` shows the item with its
form and saving works; a made-up address shows "No longer in this topic"; the four pages show the line and it reads correctly with
script off.

## 12. Step 8: documents

- `docs/mcp.md`:
  - the four view addresses (`topic-v4`, `landscape-v7`, `depth-v2`, `research-map-v4`);
  - a new part **The shell** after *Rules for the views*: what `src/apps/shell.ts` is, that a view includes it with two
    placeholders, the table of `UC` calls from [section 5](#5-step-1-the-shell-and-its-test), and the rule that the site's host gets
    no panels;
  - in each view's paragraph: a click on a topic now opens it in place; Back; the foot bar; questions;
  - `get_topic`: the `lens` argument; `questions` and `lens` in `structuredContent`; `questions` for `get_overview`, `get_rising`,
    `get_papers`;
  - *Adding a view*: step 1 gains "include the shell and call `UC.init` in the handshake branch".
- `docs/architecture.md`: `/me/save` (GET) in the row of `/me`; `apps/shell.ts` and `site/questions.ts` in the code map.
- `docs/ux-proposals.md`, under **Built**, an entry **A10** with the honest list of what was not done, from
  [section 14](#14-not-in-this-work).
- `docs/SPEC-ux-proposals.md`: nothing; it already points here.

## 13. Checking a view by hand

Tests check the shell's logic, not that a page draws. Before each of steps 3 to 6 is called done, look at the view.

1. **The fake host.** A small local page that puts the view in an `<iframe sandbox="allow-scripts" srcdoc>`, answers `ui/initialize`
   with the capabilities you choose, sends `ui/notifications/tool-result` with real-shaped data, answers `tools/call` from fixture
   files, and logs every message it gets. Two things to know when writing it: when the view's HTML is put into the host page as a
   JSON string, replace `</` with `<\/` or the view's `</script>` ends the host's script; and serve the host with `charset=utf-8`.
2. **Two hosts, every time:** as the Claude app (`hostCapabilities: { message: {}, updateModelContext: {}, openLinks: {} }`) and as
   the site (`{ openLinks: {} }`).
3. **Look at it** with headless Chrome, in light and dark and at 390 px wide: the bar does not wrap badly, a panel is readable, the
   foot bar does not cover the last row.
4. **Real data:** run a tool on a copy of the local state with `wrangler dev --persist-to <a copy of .wrangler/state>` and an env
   file holding only `DEV_BYPASS_ACCESS=1`, and POST to `/agent/mcp`. Plain `wrangler dev` loads the real keys and can make real
   calls.
5. **The Claude app decides.** After a deploy: Settings → Connectors → disconnect and reconnect, then a **new chat**. Ask for the
   view. Claude Code does not draw views.

What to try in every view: open a panel, open a second from it, Back twice; press Esc in a panel; tick three things and clear them;
change a filter and read the logged `ui/update-model-context` text; resize the frame with a panel open and after closing it.

## 14. Not in this work

Say these under *Not done* in the Built entry.

- **No panels on the site.** A click there opens the page.
- **The Landscape's and the Depth chart's own *Pick topics* selections are not in the shell's foot bar**, so they have no *Save to a
  list*. Picks made inside panels opened from them do.
- **The lens and window choosers stay in each view.** A lens chosen in one view reaches another only through what the model was told
  and the words of *Open the full view*.
- **The Research map has no panels and no ticks.**
- **A voice panel** comes with A6. **The Topic hub's filter by day and kind** is A5 part 2. **A title in Talk still opens the
  original**; *In context* opens the item panel (A1 part 3 may swap the two).
- **Scroll position** is restored only where the frame scrolls itself (fullscreen). Inline, the host owns the scroll.
- **The owner's private views** (Costs, Signal, Tweet Galaxy, Who Said It First) are untouched.
