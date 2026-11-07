# INTENT: Reimagining the public site (Agent Cortex)

This is the base for redesigning the public site at `/`. It says who the site is for, what they come to do, how they move through it,
and what the pages look like. The decisions that were open are recorded in section 13.

## 1. Why change

The data is already rich: briefings, Signal, feed pages, Research pulse, Research map, Who said it first, Topics, reports, lists. The site
shows it as one page per feature, listed in a long left menu. A reader has to know what "Signal", "Research pulse" and "Who said it first"
mean before they can choose, and nothing ties them together: a topic on Signal, the same subject in a briefing theme and the papers about it
on the Research map are three separate places.

The redesign turns this around: **the reader starts from subjects, not features.** Every feature becomes a way of looking at a subject.

## 2. Who comes, and what they want

Mainly people following AI. Politics is a second, separate area with the same structure and less attention.

| Reader | Comes for | Starts at |
| --- | --- | --- |
| **The scanner** | "What happened in AI since I last looked?" Two minutes, then gone. | The landing page, top to bottom. |
| **The specialist** | Security, agentic engineering, observability, data... Wants their area first, but also wants to notice when something elsewhere is big. | Their own area (a *lens*), remembered. |
| **The digger** | Saw something interesting, wants to know: is it real, who started it, what is the original source, what do the papers say. | A topic, then down to sources. |
| **The agent user** | Asks their own agent instead of opening the site: Claude Code while coding, the Claude app, or a scheduled routine. Wants answers in the conversation, with sources to cite and follow. | The public MCP server (section 10): as text, or as an interactive view where the host supports MCP Apps. |

Everyone shares one need: **see at a glance where to zoom in, then zoom in all the way to the original source.** For the agent user the
"glance" is a short text answer or an inline view, and "zooming in" is the next tool call.

## 3. Principles

1. **Overview first, zoom on demand.** Every page has a one-glance top and gets deeper as you scroll or click. Nothing deep is shown first.
2. **One subject, many angles.** A topic page gathers what is said (briefings), how loud it is (Signal), who said it first, what the papers
   say (arXiv) and what people are watching (YouTube, HN). The reader switches angle, not page type.
3. **Always one click from the source.** Every summary line can be followed to the post, article, video or paper it came from.
4. **Show why to trust it, and why not.** Every number says where it comes from. Signals of different kinds are never added up silently
   (see section 7).
5. **Text and picture side by side.** Each level has a short text and a graphic that say the same thing; neither is required to understand the other.
6. **Calm.** Few colours, lots of space, no autoplay, no infinite scroll. The landing page fits the important things in one screen on a laptop.

## 4. The shape of the site: three zoom levels and lenses

```
 LEVEL 1  Overview        "What is going on?"          /               (and /politics)
    │                      the landscape of topics, what is new or rising, today's briefing in brief
    ▼
 LEVEL 2  Topic           "What is this about?"        /t/<topic>
    │                      summary, timeline, angles: talk · first · papers · watch · briefings
    ▼
 LEVEL 3  Source          "Show me the original"       the post, article, video, paper
                           shown as a card with context, then out to the original site
```

**Lenses** cut across all three levels. A lens is an area of interest: *Security, Agentic engineering, Observability, Data, Models,
Infrastructure, Policy...* Choosing a lens does not hide the rest; it **orders and highlights**. Your area comes first, everything else is
still there below, and something big outside your area still breaks through ("Outside your lens: big today").

- A lens is a set of topics and terms, defined in the admin (built from existing Signal topics and briefing topics, with a model
  suggesting which topics belong to which lens).
- The chosen lens lives in the address (`/?lens=security`, shareable) and is remembered in the browser with `localStorage`, read by a small
  served script. No cookies, no accounts. Without script the lens still works through the address.

Existing pages keep their addresses and become angles or deeper views inside this structure (section 9).

## 5. User journeys

**A. The scanner, Monday morning (2 minutes)**
1. Opens `/`. Top line: "Since Friday: 3 new topics, 2 rising, 41 new papers in your areas."
2. Reads the five-line **In brief** (from today's briefings), each line linking to its topic.
3. Glances at the **landscape** graphic: one big bubble is new. Hovers: "MCP auth bypass, new, 14 sources across X, HN, blogs."
4. Done, or clicks it (journey C).

**B. The specialist in security**
1. First visit: chooses *Security* from the lens bar at the top. From now on `/` opens with that lens.
2. The page reorders: security topics first in the landscape (others dimmed, not removed), the security briefing first, security papers in
   the research strip.
3. A strip "Outside your lens" shows the one or two topics that are big everywhere today.
4. Weekly: switches the time window from *Today* to *7 days* to see what lasted.

**C. The digger follows a topic**
1. From any topic chip or bubble, opens `/t/mcp-auth-bypass`.
2. Top: one-paragraph summary (written by the model from the items), state (new / rising / steady / falling), a timeline sparkline, and
   counts per source kind.
3. Switches angles with tabs that stay on the same page:
   - **Talk**: the items behind it, grouped by source kind, each with its reactions shown honestly (section 7).
   - **Who said it first**: the ripple graphic, plus a plain list "first seen on HN 09:12, then X 10:40, blogs from 14:00".
   - **Papers**: arXiv papers on the subject, and which of them are being mentioned in posts.
   - **Watch**: videos and talks on it.
   - **Briefings**: the themes in briefings that covered it, by day.
4. Clicks a post: a source card opens (the text, author, time, reactions, why it is in this topic), with a button to the original.
5. Related topics at the foot of the page continue the walk sideways ("also talked about with: OAuth, Claude Code, prompt injection").

**D. The researcher starts from papers**
1. Opens *Research* from the top bar: the Research map with the current lens applied.
2. Clicks a cluster: its papers, and next to each one whether anyone is talking about it (mentions on X, HN, blogs).
3. A paper that is being talked about links to its topic page (journey C).

**E. A developer in Claude Code (text MCP)**
1. While working on an agent project: "Anything new on MCP security this week?"
2. Claude calls `search` ("MCP security", lens *Security*, 7 days), then `get_topic` on the best match.
3. It answers in a few lines: what happened, how widely it was talked about (in the units of section 7), who had it first, with links to the
   original posts, the HN thread and the paper. It can fetch an original to read it in full.
4. "Does it affect us?": Claude compares the topic with the code in front of it. The site gave the facts; the agent applies them.

**F. A reader in the Claude app (MCP App)**
1. "Show me what's happening in observability."
2. `get_overview` opens the **landscape view** inline, lens *Observability*. The reader drags the window to 7 days, clicks a cluster.
3. The view switches to the **topic hub** for that topic (the same tabs as the topic page). The reader selects two items and presses
   *Ask Claude about these*; Claude continues the conversation with them as context.
4. *Open on the site* goes to `/t/<topic>` for the full page.

**G. A morning routine**
A scheduled agent runs the `catch_up` prompt (lens *Agentic engineering*, since yesterday) every morning and posts the answer to the
reader's chat or channel. Same tools, no screen.

**H. Politics reader**
Same structure under `/politics`: its own lenses, landscape, topic pages and briefings. The AI site does not mix in politics topics unless asked.

## 6. The landing page

Laptop width. On a phone the same blocks stack in this order, and the landscape becomes a ranked list with small bars.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ Agent Cortex      [AI ▾]   Lens: [All] Security  Agentic  Observability  Data │
│                   Today · 3 days · 7 days                     Search topics ⌕ │
├───────────────────────────────────────────────────────────────────────────────┤
│ Since your last visit: 3 new topics · 2 rising · 41 papers                    │
│                                                                               │
│ IN BRIEF                                    │  THE LANDSCAPE                   │
│ • MCP servers hit by an auth bypass…  →     │   ( bubbles: one per topic,      │
│ • Open-weight model tops coding bench… →    │     size = attention,            │
│ • OpenTelemetry adds LLM span spec…  →      │     colour = lens,               │
│ • EU AI Act: first fines guidance…   →      │     ring = new / rising,         │
│ • Agents running CI: three new tools… →     │     close = talked about         │
│   Full briefings →                          │     together )                   │
├───────────────────────────────────────────────────────────────────────────────┤
│ RISING  ▲ MCP auth bypass  ▲ eval leakage  ● new: "vibe ops"  ▼ RAG            │
├───────────────────────────────────────────────────────────────────────────────┤
│ IN YOUR LENS: SECURITY                                                         │
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                              │
│ │ topic card   │ │ topic card   │ │ topic card   │  one line, sparkline,        │
│ │              │ │              │ │              │  source mix, "first on HN"   │
│ └──────────────┘ └──────────────┘ └──────────────┘                              │
│ Outside your lens, big today: Open-weight model release →                     │
├───────────────────────────────────────────────────────────────────────────────┤
│ RESEARCH          41 new papers · 3 clusters rising · 5 papers being discussed │
│ [small map preview]   Most discussed this week: 1. … 2. … 3. …   Research map →│
├───────────────────────────────────────────────────────────────────────────────┤
│ WATCH AND READ    latest video · most reacted articles · HN front of the week  │
└───────────────────────────────────────────────────────────────────────────────┘
```

- **Top bar** replaces the long left menu: area (AI / Politics), lens, time window, search. A small "More" menu holds Reports, Lists,
  How it works, and the existing deep pages.
- **In brief** is the one text that ties everything together: five or so lines written from the day's briefings, each line a link to a
  topic page, not to a briefing.
- **The landscape** is the one graphic of the page. Without script it is the ranked list shown on phones.
- **Since your last visit** uses a timestamp kept in `localStorage`; without it, it says "Today:".

## 7. Being honest about signals

The sources give different kinds of evidence and must not be blended into one number without saying so.

| Source | What we have | How it is shown |
| --- | --- | --- |
| **X** | Likes, reposts, replies, views. Curation and ranking by X are not trusted; numbers can be inflated. | Reactions shown as ranges ("about 2k likes"), with how many *distinct accounts* posted. Breadth (many accounts) counts more than one viral post. Engagement bait already excluded. |
| **Hacker News** | Points and comments, community-ranked. | Points and comments, linked to the thread. |
| **YouTube** | Views, from channels we chose. | Views and channel; "chosen channels" stated. |
| **Blogs and news** | Mostly no reactions. | Presence: which outlets covered it, and when. |
| **arXiv** | No popularity at all. | **Uptake**: how many posts on X, HN, blogs link to or name the paper (already detected). "Not discussed yet" is shown too, as a neutral state, not a weakness. |

On a topic page this becomes a small **evidence strip**: one segment per source kind, each with its own unit, plus the Signal score with a
"How this is worked out" link. The landscape's bubble size uses the Signal score (already balanced between groups); the tooltip spells
out the mix.

## 8. Text at different levels of detail

| Level | Text | Where |
| --- | --- | --- |
| One line | Topic name + 12-word summary | chips, bubbles, cards, In brief |
| Paragraph | What it is, why it matters, what changed since yesterday | top of the topic page |
| Briefing | The existing briefings, themes and TL;DR | Briefings angle, and the briefing pages as today |
| Source | The item itself, with author and time | source cards, then the original |

Topic summaries are written by the same model step that names Signal topics, once per topic per day, cached. Each says which items it was
written from.

## 9. Visual language and graphics

**Look.** Keep the current calm palette and light/dark/automatic theme. One accent colour for "new / rising", one colour per lens (at most
six, checked for contrast in both themes), neutral grey for everything outside the lens. Body text in a readable serif or the current sans,
numbers in tabular figures. Cards with soft borders, no shadows on shadows.

**Graphics** (each with a text equivalent next to or under it):

| Graphic | Where | Shows | Built from |
| --- | --- | --- | --- |
| **Landscape** (bubbles) | Landing | Topics by attention, in clusters of topics talked about together, coloured by lens; layout kept steady from day to day | New view; Signal data |
| **Sparkline + state** | Cards, topic page | Attention over 14 days, dashed usual level | Exists (Research pulse) |
| **Evidence strip** | Topic page | Reactions per source kind, each in its own unit | New, plain HTML/CSS (no script) |
| **Who said it first** (ripples) | Topic page, angle | Which source kind had it first, and the spread | Exists |
| **Research map** | Research, topic page (filtered) | Paper clusters, with "being discussed" marks | Exists, add uptake marks and lens filter |
| **Timeline** | Topic page | Key items over time, by source kind, as dots on one line | New |

How the existing pages fit:

| Today | Becomes |
| --- | --- |
| Today (`/`) | The new landing page |
| Briefing pages `/<topic>` | Unchanged; reached from In brief and the Briefings angle |
| Signal, Signal topic pages | Signal stays as "all topics, ranked" (the expert view); its topic pages redirect to `/t/<topic>` |
| Topics (A to Z) | Search (topics, items, papers and briefings) and the "All topics" list |
| Research pulse, Research map | The Research section; pulse topics also appear as topic pages |
| Who said it first | An angle on each topic page; the full page stays |
| Feed pages | "Watch and read" on the landing page and the Watch angle |
| Reports, Tweet Galaxy, Lists | In "More" |

## 10. For agents: the public MCP server

The site gets a second door: a **public, read-only MCP server** that gives an agent the same three zoom levels as the site. It is a
separate server from today's private `/mcp` (owner only, behind Access), which stays as it is.

**Where and who**
- Address `https://<site>/agent/mcp` (outside the `/mcp` Access application), Streamable HTTP, stateless, like the private server.
- No sign-in. It shows exactly what the public site shows (published briefings, Signals, research, feed pages) and nothing from the
  admin. Read-only, every tool marked `readOnlyHint`.
- A request never starts a model call or spends money: summaries are written ahead of time (section 8). Rate-limited per address, and
  answers cached like the pages.
- A page `/agent` on the site explains it, with the lines to copy:
  `claude mcp add --transport http agent-cortex https://<site>/agent/mcp`, and the custom connector address for the Claude app.

**The tools follow the zoom levels**

| Tool | Level | Text answer | View (MCP App) |
| --- | --- | --- | --- |
| `list_lenses` | | Areas (AI, Politics) and their lenses, with a line each | |
| `get_overview` (area, lens, window) | 1 Overview | In brief, new and rising topics, the top topics of the lens with one line each, research in short, what is big outside the lens | **Landscape** (clusters) |
| `get_topic` (topic, window) | 2 Topic | The paragraph summary, state, evidence per source kind, who had it first, top items, papers, briefing themes, related topics | **Topic hub** (tabs for the angles) |
| `get_topic_items` (topic, source kind, sort, cursor) | 3 Source | Items with author, time, reactions and link, 25 a page | (called by the views) |
| `search` (query, kinds, area, lens, window) | | Results grouped by kind, topics first: topics, items, papers, briefings | |
| `get_briefing` (topic, day) | | A briefing in full, with its themes and sources | |
| `get_papers` (topic, cluster or query, discussed only) | | Papers with abstract and uptake (who mentions them) | **Research map** |
| `get_paper` (id) | 3 Source | Abstract, links, every post that mentions it | |
| `get_who_said_first` (topic, window) | 2 Topic | The order source kinds had a topic in, in words | **Who said it first** |

Two **prompts** give agents a ready start: `catch_up` (lens, since) for "what did I miss", and `dig_into` (topic) for the full walk from
summary to sources.

**Text answers (every client, and what the model reads)**
- Markdown that leads with the answer in two to four lines, then short sections. About 1,500 tokens by default; `detail: "full"` for more.
- Every claim carries its links: the original (post, article, video, paper) and the topic page on the site, so the agent can cite and the
  reader can click.
- Evidence in the units of section 7, never one blended number without saying what is in it.
- Stable ids (topic slugs, paper ids, cursors) and a closing "next" hint ("for the items behind it: `get_topic_items` with
  `topic: mcp-auth-bypass`"), so the agent can chain calls without guessing.
- The same data as JSON in `structuredContent`, for programs and for the views.

**Interactive views (MCP App hosts, such as the Claude app and claude.ai)**
- **One view per graphic, shared by the site and the MCP App.** The site already shows the MCP views in its sandboxed frames
  (`src/site/viz.ts`), so the landscape, topic hub and research map are each built once and appear in both places.
- In the view: change lens and window, click a cluster to open its topic, switch angles, page through items. Each of these is a
  `tools/call` through the host, so the view holds no credential and can only read.
- *Ask Claude about these* sends the selected topics or items to the conversation (`ui/message`), and the selection is kept as context for
  the next turn (`ui/update-model-context`). *Open on the site* and the original links open in the browser (`ui/open-link`).
- Landscape and research map can go fullscreen. Views follow the host's light or dark theme.
- The text answer always comes too, so a host without MCP Apps (Claude Code) loses nothing but the picture.
- Built by the existing rules for views: hand-written, no SDK or bundler, a new `ui://` address each time a view changes, tested in the
  Claude app.

**The owner's private server** also gets these tools, so one connector is enough for the owner.

## 11. Constraints to keep

- **Server-rendered, no cookies, works without script.** Every page is readable without JavaScript. Graphics run only in the existing
  sandboxed frames (`src/site/viz.ts`), pinned by hash; small helper scripts are served as files, never inline (the page policy allows no
  inline script). Lens and "last visit" use the address and `localStorage`, wrapped so a blocked storage changes nothing but convenience.
- **Cached.** Pages stay cacheable; the lens is part of the address, so each lens variant is cached on its own.
- **arXiv terms.** Abstracts only, no arXiv logo or branding, keep the exact thank-you statement, every request through the one gate.
- **Phones first-class.** 16px side margins, no sideways scroll; every graphic has a list form.
- **Accessible.** Colour is never the only carrier of meaning (rings and arrows for new/rising, text labels on hover and in lists);
  keyboard-reachable graphics; contrast checked in both themes.
- **Fast.** Landing page HTML under ~60 KB, the landscape frame loaded after the text.

## 12. Building it in steps

1. **Topic page `/t/<topic>`** with summary, sparkline, evidence strip and angles as tabs (Talk, Briefings, Papers first; reuse what exists).
   This is the hub everything else links to, so it comes first.
2. **Lenses**: define them in the admin, apply them as ordering and highlighting on the topic list and Signal.
3. **New landing page**: top bar, In brief, rising strip, lens cards, research strip, watch and read. Landscape as a ranked list first.
4. **Public MCP server, text only**: `/agent/mcp` with `list_lenses`, `get_overview`, `get_topic`, `get_topic_items`, `get_briefing`,
   `get_papers`, `get_paper`, the two prompts, and the `/agent` page. It reads the same data as steps 1 to 3, so it is cheap to add here.
5. **Landscape graphic**, built as one view: in a sandboxed frame on the site and as the MCP App of `get_overview`.
6. **Topic hub view** as the MCP App of `get_topic`; the Research map as the view of `get_papers`.
7. **Who said it first and Watch angles** on the topic page; paper uptake marks on the Research map; timeline.
8. **Search across everything**: topics, items, papers and briefings, on the site and as the `search` tool.
9. **Politics** area with the same structure, lenses included, on the site and over MCP.
10. Retire the long left menu; redirects from old addresses.

Each step ships on its own and leaves the site working.

## 13. Decisions

- **A topic is a Signal topic.** It is the unit of the site. Briefing themes and research paper clusters link to the Signal topics they
  touch (already partly done), and show up on those topic pages.
- **Lenses are defined in the admin, with a model's help.** A model suggests which topics belong to which lens, and the admin accepts or
  changes the suggestions. Start with five lenses for AI.
- **Topic summaries are approved:** one model call per active topic per day, cached, recorded in Costs like every other model call.
- **The landscape groups related topics into clusters**, by how often they are talked about together. To keep it from moving around too
  much from one day to the next, start each layout from the previous day's positions and give each cluster a stable name and place where
  possible.
- **Politics works the same way:** its own lenses, landscape, topic pages and briefings under `/politics`.
- **Search covers everything:** topics, items (posts, articles, videos, threads), papers and briefings. Results are grouped by kind, with
  topics first.

## 14. Open questions (agents)

- **Anonymous or a free key?** Proposal: anonymous with a per-address rate limit. A free key would let us see who uses it and raise
  limits for heavy users, at the cost of a sign-up step.
- **Name** of the connector: `agent-cortex` is proposed.

## 15. Not in this change

Accounts, comments, personal feeds beyond a lens, notifications or email, ranking changes in Signal itself, and the admin app. Over MCP:
no tool that changes anything, starts a job or spends money, and no bulk export.
