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
