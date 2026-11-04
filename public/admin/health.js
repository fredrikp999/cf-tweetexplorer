// Why something does or does not reach readers: the admin's answers, worked out from the data its tabs already load.
// Plain functions with no page access, so the tests can run them. Loaded as a classic script, and imported by the tests for its side effect.
(() => {
  const NAMES = { x: 'X', rss: 'RSS', hn: 'Hacker News', youtube: 'YouTube', arxiv: 'arXiv' };
  const WORST = { bad: 3, warn: 2, wait: 1, ok: 0 };
  const worst = (levels) => levels.reduce((a, b) => (WORST[b] > WORST[a] ? b : a), 'ok');
  const many = (n, one, more = `${one}s`) => `${n} ${n === 1 ? one : more}`;
  const names = (xs, max = 3) => xs.slice(0, max).join(', ') + (xs.length > max ? ` and ${xs.length - max} more` : '');

  /** Whether a watch is what a briefing's "Live feed" source reads: the same rule as matchesFeed in src/collect/plan.ts. */
  function feedMatches(s, w) {
    if (w.briefing) return false;
    if (s.source && s.source !== (w.source || 'x')) return false;
    if (!s.watch) return true;
    return w.id === s.watch || String(w.label).toLowerCase().includes(String(s.watch).toLowerCase());
  }

  /** One source of a briefing: what it reads and what it costs, or why it reads nothing. A list that has not loaded is not reported as missing. */
  function sourceCheck(s, ctx = {}) {
    if (s.type === 'search') return String(s.query ?? '').trim() ? { level: 'ok', text: 'An X search, paid per post.' } : { level: 'bad', text: 'This search is empty. Fill it in, or remove it with ×.', empty: true };
    if (s.type === 'feed') {
      if (!ctx.watches) return { level: 'ok', text: 'What your watches capture in the Live feed. Free.' };
      const what = [s.source ? `${NAMES[s.source] ?? s.source} source` : 'source', s.watch ? `called “${s.watch}”` : ''].filter(Boolean).join(' ');
      const all = ctx.watches.filter((w) => feedMatches(s, w)), on = all.filter((w) => w.enabled);
      if (!all.length) return { level: 'bad', text: `No ${what} is watched, so this reads nothing. Add one under Sources.`, fix: { label: 'Open Sources', tab: 'sources' } };
      if (!on.length) return { level: 'bad', text: `Every matching watch is paused (${names(all.map((w) => w.label))}), so nothing new comes in.`, fix: { label: 'Open Sources', tab: 'sources' } };
      const failing = on.filter((w) => w.lastError);
      if (failing.length === on.length) return { level: 'warn', text: `Every matching watch is failing: ${failing[0].lastError.slice(0, 100)}`, fix: { label: 'Open Sources', tab: 'sources' } };
      return { level: 'ok', text: `Reads ${many(on.length, 'watch', 'watches')} from the Live feed: ${names(on.map((w) => w.label))}. Free.` };
    }
    if (s.type === 'flist') {
      if (!ctx.flists) return { level: 'ok', text: 'A feed list, read fresh at each run. Free.' };
      const l = ctx.flists.find((x) => x.id === s.listId);
      if (!l) return { level: 'bad', text: 'Pick a feed list. Make one under Lists and templates.', fix: { label: 'Open Lists', tab: 'lists' } };
      if (!l.members.length) return { level: 'bad', text: `The feed list “${l.name}” is empty, so this reads nothing.`, fix: { label: 'Open Lists', tab: 'lists' } };
      return { level: 'ok', text: `${many(l.members.length, 'feed')} in “${l.name}”, read fresh at each run. Free.` };
    }
    if (s.type === 'list') {
      if (!ctx.lists) return { level: 'ok', text: 'The accounts in one of your lists, paid per post.' };
      const l = ctx.lists.find((x) => x.id === s.listId);
      if (!l) return { level: 'bad', text: 'Pick an account list. Make one under Lists and templates.', fix: { label: 'Open Lists', tab: 'lists' } };
      if (!l.members.length) return { level: 'bad', text: `The account list “${l.name}” is empty, so this reads nothing.`, fix: { label: 'Open Lists', tab: 'lists' } };
      return { level: 'ok', text: `${many(l.members.length, 'account')} in “${l.name}”, paid per post.` };
    }
    if (s.type === 'xgroup' && ctx.xlists && !ctx.xlists.some((l) => (l.groups ?? []).includes(s.group))) return { level: 'bad', text: `No X list is in the group “${s.group}”, so this reads nothing.`, fix: { label: 'Open Lists', tab: 'lists' } };
    return { level: 'ok', text: s.type === 'xgroup' ? 'Every X list in this group, paid per post.' : 'An X list, paid per post.' };
  }

  /** A Signal group: is it on a public page, and if not, what would put it there. */
  function groupStatus(g, boards = [], days = 7) {
    const holding = boards.filter((b) => (b.groups ?? []).includes(g.key)), pub = holding.filter((b) => b.public), addTo = boards.filter((b) => b.public);
    if (g.weight === 0) return { level: 'warn', text: 'Muted: weight 0, so it counts nowhere and readers do not see it.', addTo: [] };
    if (pub.length) {
      if (!g.items) return { level: 'warn', text: `On ${names(pub.map((b) => b.title))}, but nothing was captured in the last ${many(days, 'day')}, so the public page leaves it out for now.`, addTo: [], boards: pub };
      return { level: 'ok', text: `Public on ${names(pub.map((b) => b.title))}.`, addTo: [], boards: pub };
    }
    if (holding.length) return { level: 'warn', text: `Only on ${names(holding.map((b) => b.title))}, which is not published, so readers do not see it.`, addTo, boards: [] };
    return { level: 'warn', text: 'Counted, but not on a published Signal, so readers do not see it.', addTo, boards: [] };
  }

  const groupOfWatch = (id, signal) => signal?.groups?.find((g) => (g.watches ?? []).some((w) => w.id === id));

  /** A briefing, from its sources to what readers get. `ctx`: watches, flists, lists, xlists, signal, when(ms) and busy (a run is in progress). */
  function briefingStatus(t, ctx = {}) {
    const when = ctx.when ?? ((ms) => new Date(ms).toISOString()), issues = t.issues ?? [], latest = issues[0], live = issues.find((i) => i.status === 'published');
    const checks = (t.sources ?? []).map((s) => sourceCheck(s, ctx)), steps = [];
    const broken = checks.filter((c) => c.level !== 'ok');
    steps.push({ key: 'sources', title: 'Sources', level: !checks.length ? 'bad' : worst(checks.map((c) => c.level)), text: !checks.length ? 'None yet, so a run has nothing to read.' : broken.length ? broken[0].text : checks.length === 1 ? checks[0].text : `${checks.length} sources, all reading.`, fix: broken[0]?.fix });

    const next = t.enabled ? `Next run ${when(t.nextRun)}.` : 'Scheduled runs are off.';
    // Not a fault: quiet sources are normal, and arXiv in particular has no new papers on many searches on a given day.
    const nothingNew = /no tweets matched/i.test(t.lastError ?? ''), hours = t.intervalHours || 24;
    let run;
    if (ctx.busy) run = { level: 'wait', text: 'Writing a new issue now.' };
    else if (nothingNew) run = { level: 'warn', text: `The last run found nothing from the past ${hours} hours, so it wrote no issue. ${next}` };
    else if (t.lastError) run = { level: 'bad', text: `The last run failed: ${t.lastError.slice(0, 160)}` };
    else if (!t.lastRun) run = { level: t.enabled ? 'wait' : 'warn', text: `Has not run yet. ${next}` };
    else if (latest && latest.tweets === 0) run = { level: 'warn', text: `The last run found nothing to read. ${next}` };
    else run = { level: t.enabled ? 'ok' : 'warn', text: `Last run ${when(t.lastRun)}${latest?.tweets ? `, from ${many(latest.tweets, 'item')}` : ''}. ${next}` };
    steps.push({ key: 'run', title: 'Last run', ...run });

    const stale = !!latest && t.updated > latest.created;
    const staleNote = stale ? ' Settings were saved after it was written, so it may not reflect them.' : '';
    if (!latest) steps.push({ key: 'issue', title: 'Newest issue', level: 'wait', text: 'Nothing written yet.' });
    else if (latest.status === 'published') steps.push({ key: 'issue', title: 'Newest issue', level: 'ok', text: `${latest.id} is published.${staleNote}` });
    else steps.push({ key: 'issue', title: 'Newest issue', level: 'warn', text: `${latest.id} is a draft and waits for your approval.${t.autoPublish ? ' It was written before “Publish automatically” was on, which only applies to later runs.' : ''}${staleNote}` });

    if (live && !t.listed) steps.push({ key: 'public', title: 'Public', level: 'warn', text: `Live at /${t.slug}, but not on the landing page, so only people with the link find it.` });
    else if (live) steps.push({ key: 'public', title: 'Public', level: 'ok', text: live === latest ? `Live at /${t.slug}.` : `Readers still see ${live.id}, the newest one published.` });
    else steps.push({ key: 'public', title: 'Public', level: 'bad', text: latest ? 'Readers see nothing: no issue is published.' : 'Readers see nothing until an issue is written and published.' });

    if (t.toSignal && ctx.signal) {
      const g = groupOfWatch(`brief:${t.slug}`, ctx.signal);
      if (g) { const st = groupStatus(g, ctx.signal.boards, ctx.signal.days); steps.push({ key: 'signal', title: 'Signal', level: st.level, text: `Group “${g.name}”. ${st.text}`, group: g.key, addTo: st.addTo }); }
    }

    const sourcesBad = steps[0].level === 'bad', draft = latest?.status === 'draft';
    let state;
    if (ctx.busy) state = { level: 'wait', label: 'Running' };
    else if (nothingNew && !sourcesBad && !draft) state = { level: 'warn', label: 'Nothing new' };
    else if (t.lastError && !nothingNew) state = { level: 'bad', label: 'Run failed' };
    else if (sourcesBad) state = { level: 'bad', label: 'Fix sources' };
    else if (draft) state = { level: 'warn', label: live ? 'New draft waiting' : 'Draft, not public' };
    else if (!latest) state = { level: 'wait', label: 'Not run yet' };
    else if (!t.enabled) state = { level: 'warn', label: 'Paused' };
    else if (live && !t.listed) state = { level: 'warn', label: 'Link only' };
    else state = { level: 'ok', label: 'Live' };

    // The one sentence that answers "why is this not showing", and the button that fixes it.
    let headline, next1;
    if (ctx.busy) headline = 'Writing a new issue. This page updates when it is done.';
    else if (t.lastError && !nothingNew) { headline = 'The last run failed, so there is no new issue.'; next1 = 'run'; }
    else if (nothingNew && !sourcesBad && !draft) { headline = `The sources had nothing from the past ${hours} hours, so the last run wrote no issue. It tries again at the next run; a broader source or a longer interval would give it more to read.`; next1 = 'settings'; }
    else if (sourcesBad) { headline = steps[0].text; next1 = 'settings'; }
    else if (draft) { headline = live ? `${latest.id} is waiting for approval. Readers still see ${live.id}.` : `Readers see nothing yet, because ${latest.id} is still a draft.`; next1 = 'publish'; }
    else if (!latest) { headline = `Nothing has been written yet. ${t.enabled ? `The first run is ${when(t.nextRun)}.` : 'Scheduled runs are off.'}`; next1 = 'run'; }
    else if (!t.enabled) headline = 'Readers see what is published, but scheduled runs are off, so nothing new comes.';
    else if (!t.listed) headline = 'Published, but only people with the link find it.';
    else if (stale) headline = `Live. Settings were saved after ${latest.id} was written, so re-run it to apply them now, or wait for the next run.`;
    else headline = t.autoPublish ? 'Live. New issues publish by themselves.' : 'Live. New issues wait as drafts for your approval.';
    return { ...state, headline, next: next1, steps, sources: checks, draft: draft ? latest : null, live: live ?? null, stale };
  }

  /** Everything a watched source reaches: the Signal group and the briefings that read it, and whether any of that is public. */
  function watchReach(w, ctx = {}) {
    const out = [];
    if (w.noSignal) out.push({ kind: 'signal', label: 'Left out of Signal', level: 'wait' });
    else {
      const g = groupOfWatch(w.id, ctx.signal);
      if (g) { const st = groupStatus(g, ctx.signal.boards, ctx.signal.days); out.push({ kind: 'signal', label: `Signal group “${g.name}”`, level: st.level, text: st.text, group: g.key, addTo: st.addTo }); }
    }
    for (const t of ctx.topics ?? []) {
      const reads = (t.sources ?? []).some((s) => (s.type === 'feed' && feedMatches(s, w)) || (s.type === 'flist' && s.listId === w.list));
      if (!reads) continue;
      const st = briefingStatus(t, { when: ctx.when });
      out.push({ kind: 'briefing', label: `Briefing “${t.title}”`, level: st.live ? 'ok' : 'warn', text: st.live ? 'Published.' : 'Nothing published yet.', slug: t.slug });
    }
    return out;
  }

  globalThis.Health = { feedMatches, sourceCheck, groupStatus, briefingStatus, watchReach };
})();
