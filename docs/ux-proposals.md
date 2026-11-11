# Proposals: surfacing, diving and new pictures

Twenty proposals for Undercurrent: ten that make the relevant thing easier to find and the way down to the source easier to walk
(part A), and ten new visualizations that work both as a page on the site and as an interactive MCP App (part B).

They build on what is there today (the landing page with its landscape, streamgraph, heat calendar and replay; topic pages with five
angles, life phase and spread bands; the research map and paper sky; Who said it first; Tweet Galaxy; readers with lenses, followed
topics and saved lists; the public MCP server at `/agent/mcp`) and keep the rules of `INTENT.md` section 11: server-rendered and
readable without script, graphics in the sandboxed frames, a text form for every picture, signals of different kinds never added up
silently, arXiv abstracts only.

Each proposal says what it is, why, how it would look on the site and over MCP, and what it needs that does not exist yet.

---

## Part A: Ten improvements to surfacing and diving

### A1. The source card: finish level 3

**Gap.** `INTENT.md` promises three zoom levels, but level 3 does not exist: an item on a topic page links straight out to x.com,
Hacker News or YouTube. The reader leaves the site at the moment they are most interested, and loses the context.

**Proposal.** A source card at `/t/<topic>/i/<item>`: the text of the item, author, time and reactions in the item's own unit, then
what only this site knows:

- **Why it is here**: the words or the meaning match that put it in the topic, and its place in the wave ("3rd item, 40 minutes after
  the first").
- **Said the same**: the copies that were folded into it (the fold already happens; the count is thrown away for the reader).
- **Before and after**: the previous and next item in the topic's timeline, so a reader can step through a story in order.
- **Also in**: other topics, briefing themes and saved lists the item belongs to.
- One clear button out to the original.

**MCP.** A `get_item` tool with the same content, and the topic hub opens an item as a panel instead of a link. *Ask Claude about this*
sends the one item.

**Needs.** A stable public id per collected item; keeping the fold count and the match reason when the topic model runs.

### A2. "What changed" as a first-class answer

**Gap.** The landscape rings what is new since the last visit, but below that level the reader gets the whole state again every time.
A topic page visited yesterday looks the same today apart from numbers.

**Proposal.** Carry the last-visit idea down every level:

- **Landing**: the top line becomes a short list, not just counts: "New: X, Y. Rising: Z (×2.4). Gone quiet: W." Each a link.
- **Topic page**: a "Since you were here" block above the angles: N new items, the phase change if any ("was emerging, now at its
  peak"), new papers, a new briefing theme. New items carry a small mark in every angle's list.
- **Summary diff**: the daily summary is already written once per topic per day; keep yesterday's and show the sentences that are new
  with a quiet highlight ("what changed since yesterday" is promised in section 8).

Same mechanism as today (a timestamp in `localStorage`, a `?since=` in the address so it works without script and is shareable).

**MCP.** `get_overview` and `get_topic` take `since` (a date or "last") and lead with the delta; the `catch_up` prompt uses it.
The topic hub gets a *New only* switch.

### A3. Search by meaning, and "more like this"

**Gap.** Search matches words (`src/site/search.ts`: "Words, not meaning"), while every item and paper is already embedded for Signal
and the research map. A reader who types "agents deleting production data" finds nothing unless those words occur.

**Proposal.**

- Rank search by meaning with the word match as a boost, and keep the grouping by kind. Say which it was ("matched by meaning") so
  the result stays explainable.
- **More like this** on every item, paper and topic: the nearest neighbours across kinds. From a paper: the posts closest to it even
  when none links to it (shown as "close in subject", never as "discussing", which stays reserved for real mentions).
- **Did you mean a topic?**: when a query sits close to a topic's centre, lead with that topic as one big result.
- Search as you type on the site with a small served script; plain form without it.

**MCP.** `search` gets `mode: "meaning" | "words"`, and a `similar` tool (id of a topic, item or paper).

**Needs.** One embedding call per query (Workers AI, bge-small): a cost per search, so cache by query and rate-limit, and record it in
Costs. This breaks the present rule that the public server never starts a model call; an embedding is small, but the rule should be
changed on purpose, not by accident.

### A4. Trails: never a dead end, never lost

**Gap.** There are no breadcrumbs, no previous/next, no keyboard, and the only sideways move from a topic is the "Goes with" line of
links at the foot.

**Proposal.**

- **A trail line** under the top bar: `AI › Security › MCP auth bypass › Papers`. Every part a link; the lens part keeps the lens.
- **Previous / next topic** in the order the reader came from (the lens's ranking, a search result, a briefing's themes), carried in
  the address (`?from=lens:security`), so a reader can go through the day's ten topics without returning to the list.
- **Neighbours strip** instead of the "Goes with" line: the related topics as small cards with state, sparkline and the one-line
  summary, so the reader can judge before clicking.
- **Peek**: hovering or long-pressing any topic link shows that one-line card (an HTML fragment fetched from `/t/<slug>/peek`, by a
  served script; without it the link just works).
- **Keys**: `/` search, `j`/`k` through a list, `[` `]` previous/next topic, `1`–`5` angles, `g l` landscape. Listed under `?`.

**MCP.** The closing "next" hints of each text answer name the neighbours and the next topic in the list, so an agent can walk too.

### A5. Pictures that filter the lists (brushing)

**Gap.** The topic page has four pictures (life curve, spread bands, heat calendar, dot timeline) and the lists below them, but they
do not talk to each other. Seeing a spike on the 4th, the reader has to scroll the list to find what happened on the 4th.

**Proposal.** Make every mark a filter, by address so it works without script and can be shared:

- A day in the heat calendar or a point on the curve → `?day=2026-11-04`: the Talk list shows that day, with a chip to clear it.
- A band in the spread picture → `?kind=hn`.
- A dot in the timeline → the source card (A1).
- On the landing page: a band of the streamgraph already links to its topic; a day column should set the landscape to that day's kept
  layout (the replay has them).
- Sort for Talk: newest, most reacted (within one kind only, so units are not mixed), earliest in the wave, most distinct accounts.

**MCP.** `get_topic_items` takes `day` and `sort: "earliest"`; in the topic hub the same marks filter in place.

### A6. Voices: pages for people and outlets

**Gap.** The data knows who said what and who was early, but a reader can only see it per topic or per source *group*. There is no way
to ask "what else has this person been early on?" or "what does this outlet cover?"

**Proposal.** A page per author or outlet, `/v/<kind>/<name>`: the topics they took part in over 30 days, how often they were among the
first three in a wave (with the same "against chance" caution as Who said it first, and nothing claimed under a minimum count), their
most reacted items, and the voices that most often appear in the same topics. Author names everywhere become links to it. A "Voices"
angle on the topic page lists who carried the topic: first, most reacted, most persistent.

Only for accounts that are already public sources of the site; no profile is built from anything but the collected items.

**MCP.** `get_voice` (name, window) and `voices` in `get_topic`. Useful to an agent asked "who should I follow on this?".

### A7. Your own front page: followed topics that report back

**Gap.** Readers can follow topics and keep lenses at `/me`, but following only stores the choice. Nothing comes back to the reader.

**Proposal.**

- A **Following** strip at the top of the landing page for a signed-in reader: each followed topic as a card with what changed since
  the last visit (A2), ordered by how much changed. Quiet ones collapse into one line.
- **Follow a search or a voice**, not only a topic: "tell me when a new topic matches *evals*".
- A **personal feed address** (Atom, with a secret in the address the reader can reset) so the changes reach a feed reader, and an
  optional weekly email digest for roles that have it. Section 15 left notifications out; with readers now in place it is the natural
  next step.
- **Mute**: a topic the reader never wants in their landscape again.

**MCP.** For a signed-in owner or a reader with a key, `get_following` (since). The `catch_up` prompt uses it when it is there.

### A8. Compare: two topics, two windows, two lenses

**Gap.** Every page shows one thing. Questions like "is MCP security bigger than prompt injection, and did it start in the same place?"
need two tabs and memory.

**Proposal.** `/compare?a=<topic>&b=<topic>`: the two life curves on one axis (each normalised to its own peak, and the absolute
counts in the table under it), the spread per kind side by side, who had each first, the items and papers they share, and the voices in
both. A *Compare with…* button on every topic page, pre-filled with its nearest neighbour. The same page compares one topic in two
windows ("this wave and the one in September") when a topic's phase is *back again*.

**MCP.** `compare_topics` (a, b); the view is the topic hub with a second column.

### A9. Sentences that show their sources

**Gap.** The topic summary says which items it was written from as a list. The reader cannot tell which sentence rests on which item,
so a surprising claim cannot be checked in one click (principle 3: "every summary line can be followed").

**Proposal.** Have the summary step return, per sentence, the ids of the items it rests on (it already has them in front of it).
Show them as small numbered marks after the sentence that open the source card (A1); a sentence resting on one single source is
marked as such ("one source"). The same for the landing page's In brief lines and briefing themes. Add a **depth switch** on the
summary: one line · paragraph · full (the three levels of section 8, which exist as separate texts today but not as one control).

**MCP.** `get_topic` text answers carry the same footnotes as links, so an agent quoting a sentence quotes its source with it.

**Needs.** A change to the summary prompt and its stored shape; a check that every cited id was in the input (drop the mark otherwise).

### A10. One connected shell for the MCP views

**Gap.** Each view (landscape, topic hub, research map, Who said it first, Signal, galaxy) is its own page with its own tool. Moving
between them works in places (landscape → topic hub) but there is no way back, no shared state, and the model does not know where the
reader has gone.

**Proposal.**

- A small shared shell in every view: a **back stack** (landscape → topic → item → back), the trail line of A4, and the lens and
  window kept across views.
- **Every step tells the model**: `ui/update-model-context` with one line ("looking at: MCP auth bypass, Papers angle, 7 days, 2
  items selected"), so "what do you make of this?" works without the reader explaining.
- **Selection everywhere**: tick topics, items or papers in any view; one *Ask Claude about these* and one *Save to list* (the saved
  lists now exist) in the shell.
- **Deep links both ways**: *Open on the site* lands on the same angle, day and filter (the addresses of A5); a site page offers
  *Open in Claude* text to copy ("Show me <topic> in Undercurrent").
- **Suggested questions** under each view, written from the data ("Why did this peak on Tuesday?", "Which papers are behind it?"),
  sent with `ui/message`.

**Needs.** The shell as one hand-written file included in each view at build time, and new `ui://` addresses for all views.

---

## Part B: Ten visualizations, for the site and for MCP Apps

Each is one view, built once, shown in a sandboxed frame on the site and as the MCP App of a tool, as the landscape is today. Each has
a list or table form for phones, no script and screen readers; nothing moves until asked, and not at all with reduced motion.

### B1. The Depth chart: what is rising, before it is news

The picture of the site's own tagline. A cross-section of water: the **surface** is where a topic is everywhere (every kind of source,
many distinct voices), the **deep** is where it lives in one place only (papers alone, one group, a handful of accounts). Each topic is
a bubble at the depth of its *breadth*, sized by attention, with a faint trail showing where it was over the last 14 days. Bubbles
rising fast have long vertical trails; that is the thing to click.

- **Read at a glance**: the deep, rising bubbles are tomorrow's news; the surface is today's.
- **Interact**: scrub the days and watch topics rise and sink; choose a lens to colour; click a bubble for its topic; a *Rising from
  the deep* list beside it names the five steepest climbs.
- **Site**: the hero of a new `/rising` page, and a small still version on the landing page. **MCP**: the view of `get_rising`.
- **Honesty**: depth is breadth (kinds and groups reached, distinct accounts), not a blended score; the tooltip spells out the mix.
- **Data**: all there (per-kind counts per day, kept daily layouts).

### B2. Crossings: how stories travel between kinds of source

An alluvial (flow) diagram for a week: columns are *first seen*, *second*, *third*, and the nodes in each are the kinds of source (X,
Hacker News, blogs and news, YouTube, arXiv). A ribbon is the topics that went that way, as thick as their number. It answers what Who
said it first cannot show for many topics at once: "most things start on X and reach blogs a day later; what starts in papers
rarely reaches YouTube".

- **Interact**: hover a ribbon to list its topics; click to keep only those; switch from kinds to your source groups (owner server);
  the median time between columns is written on each gap.
- **Site**: `/crossings`, and on a topic page that topic's own path lit on the faint whole. **MCP**: a second view of
  `get_who_said_first` (without a topic).
- **Honesty**: only waves with a real start are counted (the rules that page already has), and the number left out is shown.

### B3. Orbit: walk the neighbourhood of a topic

The chosen topic in the centre; related topics around it, nearer the more often they are talked about together, sized by attention,
ringed by state. An outer, fainter ring holds neighbours of neighbours. Click a neighbour and it glides to the centre and the ring
rearranges: browsing sideways without ever opening a list. Lines between neighbours that are themselves related show little cliques.

- **Interact**: a breadcrumb of the walk ("MCP auth → OAuth → Claude Code") to step back; a switch between *talked about together*
  and *close in meaning* (the two often differ, and the difference is interesting); select several and ask Claude.
- **Site**: replaces the "Goes with" line on topic pages as the Neighbours angle. **MCP**: a tab in the topic hub.
- **Data**: the related lists and topic vectors exist; neighbours of neighbours is one more read.

### B4. Bridges: from papers to talk

Papers on the left as short marks ordered by date, topics and posts on the right, and an **arc** for every real mention between them
(a link to the paper or its own name, as detected today). A paper with many arcs is a hub; a topic whose arcs fan out to many papers
is research-driven. Papers with no arc stay as quiet marks: "not discussed yet", shown as a neutral state.

- **Interact**: hover a paper for its title and who mentioned it; filter by research topic or lens; sort papers by first mention to
  see the **lag** (days from submission to first talk) as the slope of the arcs; click through to paper or topic.
- **Site**: on `/research` beside the pulse, and on a topic's Papers angle for that topic only. **MCP**: a second view of `get_papers`
  with `discussed: true`.
- **arXiv terms**: titles and abstracts only, the thank-you statement on the page, no arXiv branding in the picture.

### B5. The Ladder: fourteen days of rank

A bump chart: the top fifteen topics of the lens each day, one line per topic rising and falling through the ranks, new entries
starting at the edge with their name, topics that drop out fading. Where the streamgraph shows volume, this shows *order*, which is
what "what matters most today, and since when" asks for.

- **Interact**: hover a line to light it and dim the rest; pin up to three to compare; click the day header to set the whole page to
  that day; a play button draws it left to right.
- **Site**: under the streamgraph on the landing page, as its second form (a switch: *volume · rank*). **MCP**: a tab in the landscape
  view.
- **Honesty**: rank is by the Signal score, which is already balanced between groups; the page says so once.

### B6. Prism: the conversations inside a topic

A big topic is never one conversation. Take the topic's items, group them by meaning (the vectors exist), and draw each group as a
petal around the topic's name: as long as its items, coloured by the kind of source that dominates it, labelled with a short name from
its most typical items ("the exploit", "vendor responses", "is it overblown?"). Inside each petal the items are dots, by time from the
centre outwards.

- **Interact**: click a petal to filter the Talk list to that conversation; hover a dot for the item; scrub time to see which
  conversation came first and which took over.
- **Site**: at the top of the Talk angle for topics with enough items; a plain list of the groups otherwise. **MCP**: a tab in the
  topic hub, with *Ask Claude about this conversation*.
- **Needs**: clustering per topic per day and a model call to name the groups (one call per active topic, in Costs); a floor of items
  below which it is not drawn.

### B7. Tide clock: when the talk happens

A round, 24-hour dial for a topic or for the whole lens: each kind of source a ring, darker where items were published at that hour
(over 14 days), with the hour each wave began marked on the rim. A second dial by weekday. It shows rhythm the day-by-day pictures
hide: a topic that lives in US working hours, one that starts on Hacker News at night, a weekend lull.

- **Interact**: choose the time zone (the reader's by default); drag an arc of hours to list what was published then; step through
  the days as an animation of one hand going round.
- **Site**: on topic pages next to the heat calendar, which already names the weekday that stands out. **MCP**: a tab in the topic hub
  and in Who said it first.
- **Honesty**: items with a date but no time of day are left out and counted; feed items stamped with their fetch time are marked.

### B8. The Weave: how the day's briefings overlap

A matrix with the day's briefings as columns and topics as rows; a filled cell where a briefing has a theme on that topic, deeper when
the theme was the briefing's lead. Rows are ordered so topics covered by several briefings rise to the top: the things everyone
agreed mattered today. Columns and rows can be reordered by lens. Across a week it becomes a strip per day, showing which topics the
briefings kept returning to.

- **Interact**: click a cell to read that theme in place; click a row for the topic; a *Only one briefing saw this* filter for the
  odd finds.
- **Site**: on the landing page above the briefing cards (the mini maps on the cards show the same thing one briefing at a time), and
  on the briefings archive per week. **MCP**: the view of a new `get_briefings_overview` (day or week).
- **Data**: the link from themes to topics exists.

### B9. Story mode: a topic told as a scroll

The life of a topic as one annotated picture the reader scrolls (site) or steps (MCP) through: the 14-day curve stays pinned, and each
step lights a moment on it and shows what it was: *first seen* (the first item, as a card), *crosses over* (the first item of a
second kind), *the paper*, *the peak* (the most reacted item of that day), *the video*, *where it is now* (the phase). The moments are
picked by rule from data that is there; the one sentence for each can come from the daily summary step.

- **Interact**: step forward and back, or play; any card opens the source card (A1); at the end, the neighbours (B3) to continue.
- **Site**: `/t/<topic>/story`, linked from the phase badge; without script it is a plain ordered list of the moments with their
  cards, which is a good page in itself. **MCP**: the view of the `dig_into` prompt's first call, so "tell me the story of X" gets a
  picture and a narration together.
- **Share**: the last step offers the share card with the peak marked.

### B10. Your wake: the reader's own path on the map

The landscape, with the reader's own reading drawn on it: topics opened in the last weeks joined in the order they were read, as a
soft line (the wake), followed topics marked, and the regions never visited left a little dimmer. One sentence under it: "You read
mostly Security and Agents; three big topics in Data went by unopened." It turns the map into something personal, and it is the
kindest way of saying "look over here".

- **Interact**: play the wake back; click an unvisited region to open its biggest topic; *Surprise me* picks one far from the wake.
- **Site**: on `/me`, and as a switch on the landing page's landscape. **MCP**: owner and signed-in readers only.
- **Privacy**: by default the path is kept in the browser and nothing is stored or sent, as with the last visit today; a signed-in
  reader can choose to keep it with their account so it follows them between devices. The page says which is the case.

---

## A suggested order

| Step | What | Why first |
| --- | --- | --- |
| 1 | A1 source card, A5 brushing, A4 trails | Completes the three levels and connects what is already drawn; no new data except item ids |
| 2 | A2 what changed, A7 following | Gives a reason to come back; the same since-mechanism serves both |
| 3 | B1 Depth chart, B5 Ladder | Both use only existing data and answer the landing page's own question |
| 4 | A10 shell for the views, then B3 Orbit | The shell makes every later view cheaper to build and better to use |
| 5 | A9 sentences with sources, B9 Story mode | Both change the summary step; do them together |
| 6 | A3 search by meaning, B6 Prism | Both spend on models at read or build time: decide the cost rule once |
| 7 | B2 Crossings, B4 Bridges, B7 Tide clock, B8 Weave | Independent of each other; any order |
| 8 | A6 voices, A8 compare, B10 Your wake | Largest new surfaces; most value once the rest is in place |

## Decided (2026-11-11)

- **A model call at read time** (A3): only for chosen groups of readers, the admin and strategists. Everyone else, and the public MCP server, keep search by words; no anonymous request starts a model call.
- **Item ids in public addresses** (A1, A5, A9): left to the implementation. Proposal: a short hash of the item's own address, public only for items of a Signal that shows its sources and of public feed pages, for as long as the item is in the item log; after that the card answers 410 with a link to the original.
- **Voices** (A6): wanted.
- **Reader data** (A7, B10): the reader decides. Kept in the browser unless they choose, on `/me`, to keep it with their account.

## Built

- **B1 Depth chart**: `/rising`, `/rising.json` and the `get_rising` tool with its view. See [architecture.md](architecture.md) and [mcp.md](mcp.md). Not yet done from the proposal: the small still version on the landing page.
- **B5 The Ladder**: on the landing page under *Two weeks of talk* (the *Rank* choice next to *Volume*), and as the *Ladder* picture in the Landscape view of `get_overview`. Not done from the proposal: setting the whole page to a day by clicking its header (the page has no per-day form), and on the site pinning and the play button, which need script; hovering a line dims the rest there, and the MCP view has pinning and *Draw it*.
- **A1 The source card**: `/t/<topic>/i/<item>` (and `.json`), reached from the title of every Talk item and from the marks of the timeline, and the `get_item` tool; `get_topic_items` lines and the talk lists of `get_topic` now carry the item id. The id is a short hash (eleven letters and digits) of the item's own web address. See [architecture.md](architecture.md) and [mcp.md](mcp.md). Not done from the proposal: *Also in* names other topics only, not briefing themes or saved lists (those are not cheap to look up from an item); *Said the same* is a count only (no list of who repeated it) and is left out for an item that was not read for its meaning; the topic hub view does not open an item as a panel; *Ask Claude about this* with the one item is not built; the card exists while the item is within the topic's 14 days (older, up to the 30 days the item log is kept: 410 with the link to the original; after that 404), and a topic that has itself left the Signals answers 404.

## What was open before building

- **A model call at read time** (A3): today no public request starts one. An embedding per search is small, but it is a change of rule.
- **Item ids in public addresses** (A1, A5, A9): which items may have a public card, and for how long after collection.
- **Voices** (A6): whether pages about named accounts are wanted at all, and the minimum counts before "early" is said of anyone.
- **Reader data** (A7, B10): what is kept with an account and what stays in the browser.
