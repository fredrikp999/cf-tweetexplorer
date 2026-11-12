# SPEC B6: Prism, the conversations inside a topic, step by step

The build specification for proposal **B6** of [ux-proposals.md](ux-proposals.md). It replaces the B6 section of
[SPEC-ux-proposals.md](SPEC-ux-proposals.md) wherever the two differ ([section 2](#2-what-changed-from-the-first-b6-spec) lists the
differences, and most of them come from measuring).

Written against commit `348aa95` (branch `redesign-agent-cortex`), after A10 was built.

**Step 1 is already done and is in the working tree, not committed:** `src/signal/prism.ts`, `test/prism.test.mjs` and
`test/helpers/prism-fixture.mjs`. `npm run check` passes with them (690 tests, 19 of them new). Steps 2 to 6 are specified here by
function and by the place of each change; their code was not run.

## Contents

1. [What is built](#1-what-is-built)
2. [What changed from the first B6 spec](#2-what-changed-from-the-first-b6-spec)
3. [Rules for whoever builds it](#3-rules-for-whoever-builds-it)
4. [The code as it is today](#4-the-code-as-it-is-today)
5. [Step 1: the pure module (done)](#5-step-1-the-pure-module-done)
6. [Step 2: the Monitor](#6-step-2-the-monitor)
7. [Step 3: the topic page](#7-step-3-the-topic-page)
8. [Step 4: the tools](#8-step-4-the-tools)
9. [Step 5: the Topic hub](#9-step-5-the-topic-hub)
10. [Step 6: documents and the smoke test](#10-step-6-documents-and-the-smoke-test)
11. [Edge cases](#11-edge-cases)
12. [After the first deploy: check the numbers](#12-after-the-first-deploy-check-the-numbers)
13. [Not in this work](#13-not-in-this-work)

---

## 1. What is built

A topic with enough items is often several conversations at once: the exploit, what the vendors answered, whether it is overblown.
Prism finds them, names them and lets the reader narrow the list to one.

| | What the reader gets |
| --- | --- |
| **A picture** | On the Talk angle of a topic page: a petal per conversation round the topic's name, as long as its number of items, coloured by its main kind of source, its items as dots from the centre (oldest) outwards (newest) |
| **A filter** | A petal is a link to `?conv=<id>`: Talk shows that conversation, with a chip to clear it. It combines with `day`, `kind` and `sort` |
| **The words** | Under the picture, each conversation as a line: name, count, main kind, when it began, its most typical item |
| **For an agent** | `get_topic` carries the conversations; `get_topic_items` takes `conversation` |
| **In the Claude app** | A *Conversations* tab in the Topic hub with the same picture and a time slider that shows which conversation came first |

Topics with fewer than 30 items, and topics whose items do not fall into stable groups, show nothing: no picture and no line.

Six steps. **Each step is one commit, leaves `npm run check` green, and can be deployed on its own.** Do them in order.

| Step | Changes | View address after |
| --- | --- | --- |
| 1 | `src/signal/prism.ts`, `test/prism.test.mjs`, `test/helpers/prism-fixture.mjs` (done) | |
| 2 | `src/durable-objects/monitor.ts`, `src/signal/brush.ts`, `src/signal/topicpage.ts`, `src/site/topicData.ts`, `test/brush.test.mjs` | |
| 3 | `src/site/public.ts` | |
| 4 | `src/site/agentText.ts`, `src/agentMcp.ts`, `test/agenttext.test.mjs` | |
| 5 | `src/apps/topichub.ts`, `src/agentMcp.ts`, `test/hubviews.test.mjs` | `topic-v5` |
| 6 | `docs/`, `scripts/smoke.mjs` | |

After step 2 the conversations are computed and stored but nothing shows them. That is on purpose: read the stored numbers for a
few days ([section 12](#12-after-the-first-deploy-check-the-numbers)) before step 3 puts them in front of readers.

## 2. What changed from the first B6 spec

The first spec gave a method (k-means, the best silhouette, a floor on it, groups matched by the cosine of their centres). Running
it on the real model with real item titles showed that three of its four parts do not work. What was measured is in the header
comment of `src/signal/prism.ts`; the short form:

| First version | Now | Why |
| --- | --- | --- |
| Group the items' vectors as they are | **The vectors are centred first**: the topic's own mean is taken away, the rest made unit length | The model packs items on one subject together (pairs are 0.45 to 0.70 alike). On the raw vectors the groups found were one odd item against all the others (38 and 1 for a topic of 39) |
| Choose the number of groups by the best silhouette; under `PRISM_SIL_MIN` it is one conversation | **Chosen by stability**: do the same groups come back when a sixth of the items is left out? Shown only at `PRISM_STABLE_MIN = 0.7`. `PRISM_SIL_MIN` is gone | The silhouette does not tell them apart: three known conversations scored 0.07, a broad topic with no parts 0.05 to 0.08. Stability does: 0.72 and up for real groups, 0.66 and down for broad topics, under 0.25 for points with no structure |
| One start, farthest-first from the item nearest the mean | **Eight starts**, each from an item a fixed step along the list, the best fit kept | One start often ended in a poor grouping (the known conversations came out 0.57 pure; with several starts 0.73). Still the same answer for the same items |
| "The most groups", implied by `k = 2 … 6` and a best score | **The most stable number, or a larger one within 0.05 of it** | When the real groups are very clear, cutting one of them in two still scores high. "The largest number over the bar" gave five petals for three clear groups |
| Today's group is yesterday's when their centres are 0.9 alike (`PRISM_SAME`, to be calibrated) | **By the items they share**: at least 60% of the items both days have, and at least 3 | After centring, a centre moves whenever the topic's mean moves, so the cosine is not comparable from day to day. Shared items are exact. In an eight-day simulation every group kept its id on every day |
| At least 24 items | **At least 30** | One real topic of 24 items moved between 0.59 and 0.78 with nothing but the order of its items changed |
| The items of the last 14 days | **The items Talk lists**: the Signal's window, 7 days today | A petal narrows the list the reader is looking at, and its count must be the count of that list. The dots are then placed within that week |
| Rows kept 14 days | **3 days** (`PRISM_KEEP_DAYS`) | Only the latest earlier day is read, for ids and names. An address with an old `conv` is checked against today's groups whatever is kept |
| At most 30 topics a day | **At most 24**: the topics that get a summary | That list exists (`activeTopics()`), and it is the topics a reader is most likely to open |
| A name made by rule stays | **It is asked for again the next day** | A day when the cap was reached should not leave a title as the name for good |
| Depends on F4 (a topic's vector); "do it with A3" | **Depends on neither** | Prism reads `item_vec`, which exists today. F4 adds `topic_vec`, which it does not use |
| The hub draws "the same picture" | **The server works out where everything is** (`prismLayout`) for both; the hub only draws the numbers it is given | One geometry, tested once. The hub stays small |

One thing was learned that is not a change of method. **The verdict near the bar is not exact.** The numbers come from three real
topics, one written topic and four mixtures. That is enough to see that the method works and where the bar belongs, and not enough
to promise that every topic falls on the right side of it. [Section 12](#12-after-the-first-deploy-check-the-numbers) says how to
check after a deploy, before readers see anything.

## 3. Rules for whoever builds it

1. **Do not change `src/signal/prism.ts` to make a later step easier.** Its numbers were measured. If a step seems to need a
   change there, stop and report it.
2. **No model call outside the Monitor's alarm.** Not from a page, not from `/agent/mcp`, not from `/mcp`. The names are written
   once a day, inside the Signal topic model's daily cap, and recorded with `recordCost` as **Topic conversations (AI)**.
3. **A name is a model's words about other people's text.** It goes through `cleanPrismName`, is escaped like any text on the
   page, and is set with `textContent` in the view. Titles sent to the model are quoted material: the prompt says so and the test
   checks it.
4. **Item titles, links and authors show only for a Signal that shows its sources** (`board.proof`). For one that does not: petals,
   names and counts, and nothing else ([section 11](#11-edge-cases)).
5. **Kinds of source are never added or ranked against each other.** A petal's count is a count of items, which is fine. Nothing
   in Prism orders by reactions.
6. **`conv` is an address parameter like `day` and `kind`:** checked strictly, dropped when not understood, never an error page,
   and part of the cache keys only in its checked form.
7. **The view rules of A10 hold in step 5:** do not touch the hub's handshake; one classic inline script; no backticks and no
   `${` in the view's own code; a backslash is written twice; bump the address once (`topic-v5`).
8. **Run `npm run check` after every step.** If the code does not match what a step says to find, stop and report it.

## 4. The code as it is today

What each step builds on. Names are exact; line numbers are those of commit `348aa95`.

**The Monitor** (`src/durable-objects/monitor.ts`)

| What | Where | Note |
| --- | --- | --- |
| `item_vec (watch, item, day, v, copy)` | constructor, line 167 | A vector per item the topic model read. `copy != ''` marks a repeat of an earlier post. Exists only while topic detection by a model is on |
| `topicItems(v, names)` | line 1602 | Returns `{ hits, items, wide, meta }`. `items`: the topic's items inside the Signal's window (what Talk lists). `wide`: 14 days. `meta`: for each item, its `{ watch, item, matched }`. Briefing posts and papers are already left out |
| `topicData(slug, hint, brush)` | line 1639 | Builds the topic page's data. Talk is `brushItems(items, view, cap)` |
| `topicItemsPublic(p)` | line 447 | The pages of `get_topic_items`. Same brush |
| route `topic-public` | line 1946 | Checks the brush, builds the cache key `topic|<slug>|<hint>|<brush>`, keeps the answer two minutes |
| `summaryStep(deadline)`, `summaryWake()`, `activeTopics()` | lines 1809, 1799, 1747 | The pattern to follow: once a day, from the alarm, inside `aiSpend()` and `cfg.dailyCap`, a deadline, `recordCost` |
| `alarm()`, `reschedule()` | lines 225, 214 | Where a new step and its wake time are added |
| `aiConfig()`, `aiSpend()`, `tables()` | lines 977, 992, 997 | The model, today's spending, and whether the model's topics are in use (`tables().ai`) |
| `complete(env, model, messages, { maxTokens, mock })` | `src/llm/analysis.ts` | `mock` answers when `SUMMARY_MOCK=1` (local runs) |

Found while reading, and to be fixed in step 2 because the new step needs it: `summaryStep` ends with
`this.pubCache.delete(\`topic|${slug}\`)`, but the keys are `topic|<slug>|<hint>|<brush>`, so that line deletes nothing and a new
summary shows up to two minutes late. Step 2 adds a helper that deletes every key of a topic and uses it in both places.

**The brush** (`src/signal/brush.ts`): `Brush { day?, kind?, sort }`, `BrushAsk`, `parseBrush(ask, days, fallbackSort)`,
`brushParams(b)`, `brushItems(items, b, cap)`. Tested in `test/brush.test.mjs`.

**The page** (`src/site/public.ts`): `topicPanel(d, angle, ctx, from)` draws Talk (line 1141); `brushControls` the chips and the
kind and order rows (line 1133); `brushHref` builds a filtered address (line 1128); `kindShape` and `KIND_MARK` give each kind of
source its shape; the colours are `--k-x`, `--k-hn`, `--k-youtube`, `--k-rss` (line 256). The edge-cache key is the list of
parameter names on line 2210.

**The tools** (`src/site/agentText.ts`, `src/agentMcp.ts`): `topicOut` builds `data` and the text sections; `itemsOut` the pages of
items; `get_topic_items` is registered at line 146 of `agentMcp.ts`.

**The hub** (`src/apps/topichub.ts`, `topic-v4`): `TABS` and `PANES` are where an angle is added; `T` holds Talk's state
(`kind`, `sort`, …); `loadItems(reset)` calls `get_topic_items`; `contextText()` and `siteUrl()` feed the shell.

## 5. Step 1: the pure module (done)

Three files are in the working tree. Read `src/signal/prism.ts` before step 2; this section is its map.

### What `src/signal/prism.ts` offers

| Export | Does |
| --- | --- |
| `buildPrism(items, prev, day)` | Today's conversations of one topic, or `null`. `items`: `{ key, v, ts, kind, title }`, in any order. `prev`: the latest earlier day's, for ids and names |
| `unnamed(prism)` | The groups that still need a name from the model (none yet, or made by rule) |
| `prismSystem()`, `prismUser(label, titles[][], named[])` | The two messages of the one call per topic |
| `parsePrismNames(text, count, taken[])` | Names by the position they were asked in. Unusable, repeated and out-of-range ones are left out |
| `cleanPrismName(raw)`, `ruleName(title)` | A name as it may be shown; the name when no model gave one (the most typical title, cut, in quotation marks) |
| `parseConv(raw, groups)` | The conversation an address asks for: one of today's ids or `null` |
| `prismLayout(out)` | Where every petal, label and dot is drawn, for the page and the hub |
| `groupVectors`, `stability`, `kmeans`, `centred`, `agreement` | The parts, exported for the tests and for [section 12](#12-after-the-first-deploy-check-the-numbers) |

Shapes:

```ts
// stored, one row per topic per day
interface Prism { day: string; stable: number; groups: PrismGroup[]; other: string[]; next: number }
interface PrismGroup { id: string; name: string; by: 'model' | 'rule' | ''; n: number; kind: EvKind | 'mixed'; began: number; last: number;
  typical: string[]; items: string[] }           // keys are the Monitor's own: "watch\nitem"

// given to the page and the tools
interface PrismOut { day: string; groups: PrismView[]; other: number; from: number; to: number }
interface PrismView { id: string; name: string; by: 'model' | 'rule'; n: number; kind: EvKind | 'mixed'; began: number; last: number;
  typical: PrismTypical[]; dots: Array<{ id: string; ts: number }> }     // public item ids; both lists empty for a Signal that hides its sources
interface PrismTypical { id: string; kind: EvKind; title: string; url: string; by: string; source: string; ts: number }
```

Constants, all exported with a comment saying how each was set: `PRISM_MIN = 30`, `PRISM_ITEMS = 150`, `PRISM_STABLE_MIN = 0.7`,
`PRISM_STABLE_KEEP = 0.55`, `PRISM_NEAR = 0.05`, `PRISM_GROUP_MIN = 4`, `PRISM_SAME = 0.6`, `PRISM_SAME_ITEMS = 3`,
`PRISM_TYPICAL = 5`, `PRISM_TOPICS = 24`, `PRISM_KEEP_DAYS = 3`, `CONV_ID = /^c[1-9]\d{0,3}$/`.

### How a topic's conversations are decided

1. The items are put in the order of their time (ties by key), and only the newest 150 are kept. So the same items give the same
   groups in whatever order they arrive.
2. The vectors are centred.
3. For 2 to 6 groups (never more than a quarter of the number of items) the stability is measured: three ways of leaving out a
   sixth of the items, six runs each, compared pair by pair.
4. If the best stability is under 0.7 the topic is **one conversation** and the answer is `null`.
5. Otherwise the largest number of groups within 0.05 of the best (and at 0.7 or more) is taken.
6. **Yesterday counts.** A topic that had conversations yesterday keeps that number of groups while it still scores 0.55, so a
   topic at the edge does not lose its picture one day and get it back the next. It gets one more group only when the larger
   number passes the full bar.
7. Groups of fewer than 4 items become **Other**. At least two real groups must be left.
8. Each group of today takes the id and the name of the group of yesterday it shares most items with (60% of the items both days
   have, at least 3). The others get the next free id: `c1`, `c2`, … counted up per topic, never used twice.

### The cost in time

Measured in Node on a laptop: 12 to 70 ms for a topic of 30 to 50 items, about 0.5 s for 120, under 1 s at the cap of 150. For 24
topics that is a few seconds on a usual day and at worst about 20, which is why step 2 gives the work a deadline and lets it carry
on at the next wake-up.

### The tests (`test/prism.test.mjs`, 19)

Made-up vectors for the rules (the same items in another order, no structure, too few, a small group into Other, ids and names
kept, a new group's id, a rule-made name asked again), and real vectors from `test/helpers/prism-fixture.mjs` for the two verdicts
that matter: one story with three known sides is split, and the real topic *ai security* of 2026-11-12, which has no clear parts,
gets no picture.

### How the fixture was made

So it can be made again with other texts. `@huggingface/transformers` with `Xenova/bge-small-en-v1.5` gives the same vectors as
Workers AI's `@cf/baai/bge-small-en-v1.5`; install it outside the repository.

```js
import { pipeline } from '@huggingface/transformers';
const p = await pipeline('feature-extraction', 'Xenova/bge-small-en-v1.5');
const embed = async (texts) => (await p(texts, { pooling: 'mean', normalize: true })).tolist().map((v) => v.map((x) => Math.round(x * 1000) / 1000));
```

The texts are in the fixture next to their vectors: 30 written titles of one story with their side, and the 39 titles of a real
topic read through `get_topic_items`. They are titles only. In production an item's vector is made from up to 500 letters of its
text (`embedText`), which is one reason for [section 12](#12-after-the-first-deploy-check-the-numbers).

## 6. Step 2: the Monitor

Everything that computes, stores and hands out conversations. No page shows them yet.

### 6.1 `src/signal/brush.ts`: the filter gains a conversation

- `Brush` gains `conv?: string`; `BrushAsk` gains `conv?: string | null`.
- `parseBrush(ask, days, fallbackSort = DEFAULT_SORT, convs: string[] = [])`: `conv` is kept only when it is one of `convs`.
- `brushParams` adds `['conv', b.conv]` after `kind`.
- `brushItems` is not changed: the caller narrows the items to the conversation before calling it (it has the membership, the
  brush module does not).

`test/brush.test.mjs` gains: a `conv` that is in `convs` is kept and one that is not is dropped; `brushParams` writes it; it
combines with `day` and `kind` (all three in one `Brush`, all three in the parameters).

### 6.2 The table

In the constructor, after `topic_summary`:

```ts
// Prism (src/signal/prism.ts): the conversations inside a topic, one row per topic per day; json is a Prism with `counted` (how many items were grouped), or { none: true, counted } for a topic that was looked at and is one conversation.
sql.exec('CREATE TABLE IF NOT EXISTS topic_prism (board TEXT NOT NULL, slug TEXT NOT NULL, day TEXT NOT NULL, json TEXT NOT NULL, model TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (board, slug, day)) WITHOUT ROWID');
```

`board` is the Signal's address (`board.slug`), `slug` the topic's (`topicSlug(topic.term)`). The json is one of two things:

```ts
type PrismRow = (Prism & { counted: number }) | { none: true; counted: number }
```

A `none` row means *looked at today, nothing to show*, so the work is not done twice in a day. `counted` is how many items had a
vector and were grouped; the owner's status line reads it ([6.7](#67-one-line-for-the-owner)). Below, "a row with groups" means
the first form.

### 6.3 Reading the vectors of a topic

A private method next to `topicItems`:

```ts
/** The items Talk lists, as Prism needs them: only those that were read for their meaning and are not a copy of an earlier post. */
private prismItems(items: EvItem[], meta: Map<EvItem, { watch: string; item: string }>): PrismItem[]
```

For each item with a `meta` entry: `SELECT v, copy FROM item_vec WHERE watch = ? AND item = ?`; skip when there is no row or
`copy != ''`; give `{ key: watch + '\n' + item, v: fromBlob(v), ts, kind, title }`. An item without a vector is simply not in any
conversation.

### 6.4 `prismStep(deadline)` and `prismWake()`

Modelled on `summaryStep` and `summaryWake`. Differences are marked.

```ts
private prismWake(): number
```

- `0` when there is nothing to do: `!this.tables().ai` (no vectors are being made), no published Signal, or
  `this.getMeta('prismDay', '') === today()`.
- Otherwise `Date.now() + 1000`. **Not** held back by the daily cap: the grouping costs no money, and only the names do.

```ts
private async prismStep(deadline: number): Promise<void>
```

1. Return at once on the same three conditions.
2. `const done = new Set(…)`: the `board + '\n' + slug` of today's rows.
3. For each `slug` of `await this.activeTopics()` (at most `PRISM_TOPICS`; the list is already at most 24):
   1. `if (Date.now() > deadline) return;` (it carries on at the next wake-up; `prismDay` is not set).
   2. `const found = await this.findTopic(slug); if (!found) continue;` then `board = found.v.board.slug`,
      `canonical = topicSlug(found.topic.term)`. Skip when `done` has it.
   3. `const { items, meta } = await this.topicItems(found.v, names)`, then `const pis = this.prismItems(items, meta)`.
   4. `prev`: the newest earlier row of this topic that has groups, inside `PRISM_KEEP_DAYS`
      (`SELECT json FROM topic_prism WHERE board = ? AND slug = ? AND day < ? ORDER BY day DESC LIMIT 3`, the first whose json
      has `groups`). A day with a `none` row in between does not break the line: ids and names survive it.
   5. `const p = buildPrism(pis, prev, day);`
   6. **Names**, when `p` and `unnamed(p).length`:
      - Only when `cfg.enabled && cfg.model && this.aiSpend().cost < cfg.dailyCap`. Otherwise skip to the rule.
      - One call: `complete(this.env, cfg.model, [prismSystem(), prismUser(found.topic.label, need.map((g) => titlesOf(g.typical)), named)], { maxTokens: 200, mock })`.
        `titlesOf` looks the keys up among `pis`. `named`: the names of the groups that already have a model's name.
        `mock`: `() => JSON.stringify({ names: need.map((_, i) => ({ i: i + 1, name: 'conversation ' + (i + 1) })) })`.
      - Record the cost exactly as `summaryStep` does, with `ref: 'topic-prism'` and `label: 'Topic conversations (AI)'`, and add
        it to `aiSpend`.
      - `parsePrismNames(r.text, need.length, named)`; each name found is set on its group with `by = 'model'`.
      - A failed call (`catch`) is logged with `console.error` and goes on to the rule. No retry today, no counter: the row is
        written, and tomorrow the group is asked for again because its name is by rule.
      - **The rule:** every group that still has no name gets `ruleName(title of its first typical item)` and `by = 'rule'`. A
        group that already has a rule-made name from yesterday keeps it.
   7. `INSERT OR REPLACE INTO topic_prism (board, slug, day, json, model, at)` with
      `JSON.stringify(p ? { ...p, counted: pis.length } : { none: true, counted: pis.length })`, and `cfg.model` when a model
      named something today, else `''`.
   8. `this.dropTopicCache(canonical)` (6.6).
4. After the loop: `this.setMeta('prismDay', day)` and
   `DELETE FROM topic_prism WHERE day < ?` with the day `PRISM_KEEP_DAYS` back.

**In `alarm()`**, directly after the `summaryStep` line and before `processAi`:

```ts
try { await this.prismStep(Date.now() + 15_000); } catch (err) { console.error('topic conversations failed', err instanceof Error ? err.message : String(err)); }
```

After the summaries, because the cap is shared and a day's summaries matter more than a day's names.

**In `reschedule()`**, after the `summaryWake` line: `const prism = this.prismWake(); if (prism) next = Math.min(next, prism);`

**In the route `topic-public`**, the line that wakes the summary writer becomes
`if (url.searchParams.get('quiet') !== '1' && (this.summaryWake() || this.prismWake())) await this.reschedule();`.

### 6.5 Handing them out

A private method:

```ts
/** A topic's conversations as the page and the tools get them, or null: today's or yesterday's row, counted over the items the list has now. */
private prismOut(board: string, slug: string, items: EvItem[], meta: Map<EvItem, { watch: string; item: string }>, proof: boolean): { out: PrismOut; of: Map<string, string> } | null
```

- The newest row of `(board, slug)`, when its day passes `summaryFresh(day)` (today or yesterday) and it has groups. A newest row
  that says `none` means none: yesterday's groups are not shown in its place.
- `byKey`: the items of the list by `watch + '\n' + item`.
- For each stored group: `here` = its `items` that are in `byKey`. A group with none left is dropped. `n = here.length`,
  `began` and `last` from `here`. `dots`: when `proof`, the items of `here` that have a public id, as `{ id, ts }`; else `[]`.
  `typical`: when `proof`, its stored typical keys that are in `byKey` and have an id, as `PrismTypical`; else `[]`.
  `kind` is counted again from `here`.
- `other`: how many of the stored `other` keys are in `byKey`.
- **Fewer than two groups left: `null`.** A picture of one petal says nothing.
- `from` and `to`: the oldest and the newest time among all the items counted.
- `of`: public item id → conversation id, for the filter. Built for every item of `here` whatever `proof` is; it never leaves
  the Monitor.

**In `topicData`:**

- Take `meta` as well: `const { hits, items, wide, meta } = await this.topicItems(v, names)`.
- After `byKind`: `const pr = this.prismOut(board.slug, canonical, items, meta, proof);`
- The brush becomes
  `const view = parseBrush(brush, days.filter((d) => d >= c.from), DEFAULT_SORT, pr ? pr.out.groups.map((g) => g.id) : []);`
- The list is narrowed before it is ordered:
  `const pool = view.conv ? items.filter((i) => i.id && pr!.of.get(i.id) === view.conv) : items;` and `brushItems(pool, view, view.day || view.kind || view.conv ? TALK_CAP_NARROW : TALK_CAP)`.
- The answer gains `prism: pr?.out ?? null`.

`TopicData` in `src/signal/topicpage.ts` gains `prism?: PrismOut | null` (with a one-line comment), and `view` already takes the
new field through `Brush`.

**In `topicItemsPublic`:** the same three lines (`prismOut`, the `convs` argument, the narrowed pool); the answer gains
`conv: view.conv ? { id, name } : null`. It reads the parameter `conv`.

**In the route `topic-public`:** `conv` joins the brush that is checked for the cache key. The groups are not known there, so the
shape is checked instead: pass `convs = CONV_ID.test(raw) ? [raw] : []`. An id of the right shape that is not a group of today
then has a cache entry of its own holding the plain list, which is harmless and bounded (the existing rule already drops the
oldest entry over 300).

**`src/site/topicData.ts`:** `loadTopic` passes `&conv=` when `opts.brush?.conv` is set, as it does for `day`, `kind` and `sort`.

### 6.6 Clearing a topic's cached answers

```ts
/** Forgets every kept answer of one topic (all hints and filters), after its summary or its conversations changed. */
private dropTopicCache(slug: string): void { for (const k of [...this.pubCache.keys()]) if (k.startsWith(`topic|${slug}|`)) this.pubCache.delete(k); }
```

Use it in `prismStep`, and replace the line in `summaryStep` that deletes `topic|${slug}` with it.

### 6.7 One line for the owner

In the route block, next to `signal-ai`:

```ts
if (name === 'prism-status') return json(this.prismStatus());
```

`prismStatus()` returns today's rows as
`{ day, topics: [{ board, slug, items: <how many were grouped>, groups: <n or 0>, stable: <number or null>, names: <'model' | 'rule' | 'mixed' | ''> }] }`.
It is what [section 12](#12-after-the-first-deploy-check-the-numbers) reads. It is not a public route (its name does not end in
`-public`); it shows no item.

`items` is the row's `counted`.

### Done when

- `npm run check` passes.
- On a local `wrangler dev` on a **copy** of the state (`--persist-to`), with an env file holding `DEV_BYPASS_ACCESS=1` and
  `SUMMARY_MOCK=1` (no real model call): after the alarm ran, `/admin/mon/prism-status` lists the active topics; a topic with
  conversations has names `conversation 1`, `conversation 2`; `/t/<slug>.json` has `prism` with groups whose counts add up to no
  more than the topic's items; `/t/<slug>?conv=c1` (the page is unchanged in looks) lists fewer items than `/t/<slug>`.
- Running the alarm a second time the same day makes no second model call (Costs shows one line per topic).
- With the daily cap set to 0 the rows are written with names in quotation marks and Costs shows nothing new.

## 7. Step 3: the topic page

File `src/site/public.ts`.

### 7.1 The address

- The topic route reads it: the `brush` given to `loadTopic` gains `conv: url.searchParams.get('conv')`.
- The edge-cache key (the list on line 2210) gains `'conv'`.
- `brushHref` needs no change: it writes what `brushParams` gives.

### 7.2 The picture

A function next to `timelineHtml`:

```ts
/** Prism (B6): the conversations inside the topic as petals, each a link that narrows Talk to it. Inline SVG, no script; the list under it says the same. */
function prismSvg(d: TopicData, p: PrismOut, b: Brush, from?: From | null): string
```

It calls `prismLayout(p)` and draws, in this order inside `<svg class="prism" viewBox="0 0 ${PRISM_W} ${PRISM_H}" role="img" aria-label="…">`:

1. Per petal:
   - The body: `<path class="pp k-<kind>" d="<petal.path>">` with a `<title>` "*name*: *n* items". Class `other` for Other,
     `mixed` for a mixed kind, and `on` when `b.conv` is this conversation.
   - A conversation's body is wrapped in `<a href="…">` to `brushHref(d, { ...b, conv: b.conv === id ? undefined : id }, from)`,
     so a second click on the chosen petal clears it. Other is not a link.
   - At the tip, the kind's shape: `kindShape(kind, tipX, tipY, 4, 'pk', KIND_NAME[kind])`; none for mixed or Other.
   - The dots, only for a Signal that shows its sources: `<a href="${itemHref(d.slug, dot.id, d.area)}"><circle class="pd" cx cy r="2.4"><title>…</title></circle></a>`.
     The title is the item's date; the item's own title is not in `dots`, and the list under the picture names the typical ones.
   - The label at `petal.label`, `text-anchor` from `petal.anchor`: the name on one line, or on two when it is longer than 16
     letters (split at the middle space), then the count in a `<tspan class="pn">`. For a label above or below the picture
     (`anchor` is `middle`) move it up by one line's height per extra line when the tip is above the centre.
2. The centre: `<circle class="pc" r="${r0}">` and the topic's name, cut at 22 letters, on at most two lines.

The `aria-label`: "*label*: *n* conversations. " followed by each as "*name*, *n* items".

The CSS, with the page's other small rules (this is what the trial rendering used):

```css
.prism{max-width:520px;width:100%;height:auto;display:block;margin:0 0 6px}.prism text{font-size:12px;fill:var(--text)}.prism .pn{fill:var(--muted);font-size:11px}.prism .pt{font-size:10px;font-weight:600}
.pp{fill:color-mix(in srgb,var(--pk,var(--muted)) 20%,var(--card));stroke:var(--pk,var(--muted));stroke-width:1.2}.pp.k-x{--pk:var(--k-x)}.pp.k-hn{--pk:var(--k-hn)}.pp.k-youtube{--pk:var(--k-youtube)}.pp.k-rss{--pk:var(--k-rss)}.pp.other{stroke-dasharray:3 3}
.pp.on{stroke-width:2.6}.prism a:hover .pp,.prism a:focus-visible .pp{stroke-width:2.4}.prism a:focus-visible{outline:none}.pd{fill:var(--text);opacity:.55}.prism a:hover .pd,.prism a:focus-visible .pd{fill:var(--accent);opacity:1}.pc{fill:var(--card);stroke:var(--line)}.pk{fill:var(--pk,var(--muted))}
.plist{list-style:none;margin:0 0 6px;padding:0;display:grid;gap:6px}.plist li{border-left:3px solid var(--line);padding-left:10px}.plist small{color:var(--muted)}
```

`.pp.k-x` already sets `fill` through the page's `.k-x` rule (line 253); the rules above come after it in the stylesheet so they
win. Check it in the screenshot: a petal must be a tint, not a solid colour.

### 7.3 The words under it

```ts
function prismHtml(d: TopicData, b: Brush, from?: From | null): string
```

Returns `''` when `!d.prism`. Otherwise:

```html
<div class="prismbox"><h3 class="azh">Conversations inside it</h3>
<svg class="prism">…</svg>
<ol class="plist">
  <li><a href="…?conv=c1#angle"><b>the exploit</b></a> <small>16 items · mostly X · from 3 Nov</small>
      <div><a href="/t/<slug>/i/<id>">Most typical: <title of its first typical item></a></div></li>
  …
</ol>
<p class="meta">3 more items are in none of these.</p>
<p class="meta">The items are grouped by what they say, by a model, and each name was written by a model from the most typical items. A name in quotation marks is the title of the most typical item. It can get things wrong.</p></div>
```

- "mostly X" is `KIND_NAME[g.kind]`; for `mixed` write "several kinds of source".
- The *Most typical* line only when `g.typical[0]` exists (so not for a Signal that hides its sources).
- The *more items* line only when `p.other > 0`.
- The sentence about quotation marks only when a group is `by: 'rule'`.

### 7.4 Where it goes, and the chip

- In `topicPanel`, in the Talk branch, `prismHtml(d, b, from)` comes **before** `controls` in both returns (the list, and the
  "nothing is logged for this filter" line), so the picture stays when a filter empties the list.
- For a Signal that does not show its sources, Talk today returns one note. With a prism it returns
  `prismHtml(...) + the note`: the petals, names and counts are shown, with no dots and no typical items.
- In `brushControls`, a third chip after the kind's:
  `Showing <b>${esc(name)}</b> · <a href="${esc(bh({ ...b, conv: undefined }))}">clear</a>`, where `name` is the group's name
  from `d.prism`.
- In the Talk heading line, `narrow` also counts `b.conv`, and the "Nothing … is logged" sentence names the conversation when one
  is chosen.

### Done when

- `npm run check` passes (`test/topicpage.test.mjs` and `test/landing.test.mjs` unchanged and green).
- Rendered from fixtures and screenshotted with headless Chrome, in light and dark and at 390 px: three petals with their labels
  inside the picture; a chosen petal is thicker and the chip names it; the list under the picture says the same numbers.
- With script off everything works: every petal, dot and name is a link.
- A topic with no prism renders exactly as before (compare the HTML of one before and after).
- A page with `?conv=zz` or an id that is not a group renders the plain page, with status 200.

## 8. Step 4: the tools

### 8.1 `get_topic` (`topicOut` in `src/site/agentText.ts`)

`data` gains, after `related`:

```ts
prism: t.prism ? { day: t.prism.day, groups: t.prism.groups.map((g) => ({ id: g.id, name: g.name, namedBy: g.by, n: g.n, kind: g.kind, began: g.began, last: g.last,
    typical: g.typical.map((i) => ({ id: i.id, title: i.title, url: i.url, by: i.by, kind: i.kind })) })), other: t.prism.other,
  layout: prismLayout(t.prism), from: t.prism.from, to: t.prism.to } : null,
```

The text gains a section between *What is being said* and *Papers*, only when there is a prism:

```
## Conversations inside it
- **the exploit** `c1`: 16 items, mostly X, from 3 Nov. Most typical: [title](url)
- **vendor responses** `c2`: 11 items, mostly Blogs and news, from 4 Nov. Most typical: [title](url)
_Grouped by what the items say, by a model; the names were written by a model. 3 more items are in none of these._
```

For a Signal that hides its sources the *Most typical* part is left out. In `brief` detail at most four conversations are listed.
The `Next:` hints gain, first after the walk hint:
`get_topic_items with topic: "<slug>" and conversation: "<first id>" for the items of one conversation`.

### 8.2 `get_topic_items`

In `src/agentMcp.ts`: `inputSchema` gains

```ts
conversation: z.string().regex(/^c[1-9]\d{0,3}$/).optional().describe('Only the items of one conversation inside the topic: an id such as "c2" from get_topic (its "Conversations inside it"). An id the topic does not have today is ignored.'),
```

It is added to the destructured arguments, to the object given to `run(...)` (the cache key) and to the parameters as `conv`.
The tool's description gains one sentence: "…or by one conversation inside the topic (ids from `get_topic`)."

In `itemsOut`: `ItemsIn` gains `conv?: { id: string; name: string } | null`; `a0` gains `conversation?: string`; `data` gains
`conversation: r.conv ?? null`; the lead says "… in the conversation *name*" when `r.conv`, and, as for a day that was not
understood, "`c9` is not a conversation of this topic today, so it was ignored." when one was asked for and `r.conv` is null.
The `Next:` line for the next page carries `conversation`.

### 8.3 Tests (`test/agenttext.test.mjs`)

- `topicOut` for the fixture topic with a `prism` of two groups: `data.prism.groups` has both with their ids; `data.prism.layout`
  has two petals; the text has "Conversations inside it" and both names; the `Next:` line names `conversation`.
- The same with `board.proof` false and empty `typical`: no "Most typical", and no item title anywhere in the section.
- Without a `prism`: no section, `data.prism` is `null`, and the text equals today's (compare with the existing expectation).
- `itemsOut` with `conv`: the lead names the conversation and `nextCursor`'s hint carries it; an id that was ignored is said.

### Done when

`npm run check`; over `/agent/mcp` on the local server `get_topic` returns `prism` and the section, `get_topic_items` with
`conversation: "c1"` returns fewer items than without and says which conversation, and Costs is unchanged by both.

## 9. Step 5: the Topic hub

File `src/apps/topichub.ts`, to `topic-v5`. The picture is drawn from `D.prism.layout`; the hub works out no geometry.

**Edit 1, the tab.** `TABS` gains `['conv', 'Conversations']` after `'talk'`; `PANES` gains `conv: convPane`; `TABNAME` gains
`conv: 'Conversations'`. In `renderTabs`, skip the tab when `!D.prism` (the same place the count `n` is worked out; give the tab
the number of groups as its count).

**Edit 2, the state.** `T` gains `conv: ''` (in both places `T` is made: the `var` and the reset in `show`). A second variable
`var PT = 0;` holds the slider's time; `show` sets it to `D.prism ? D.prism.to : 0`.

**Edit 3, `convPane(p)`.** In plain DOM calls (`mk` for HTML, `document.createElementNS(NS, …)` for SVG, text only through
`textContent`):

1. An `<svg viewBox="0 0 520 340">` with, per petal of `D.prism.layout.petals`:
   - a `<path d=petal.path>` with the kind's colour (the hub's CSS gains the four `--k-…` values and the `.pp` rules of step 3,
     written without backticks). It is a button in effect: `tabindex="0"`, `role="button"`, `aria-label` "*name*, *n* items",
     and click or Enter calls `pickConv(id)`. Other is not one;
   - its dots as `<circle>`, **only those with `ts <= PT`**; a click opens the item panel: `UC.open('item', { topic: D.slug, item: dot.id, area: D.area })`;
   - its label, as in step 3, with the count **at `PT`** (the number of its dots shown; for a Signal that hides its sources the
     full count, and no slider).
   - the centre circle and the topic's name.
2. Under it, when there are dots: a slider `<input type="range" min=from max=to step=3600000 value=PT>` with the label
   "Up to" and the chosen time in words. On `input`: set `PT`, redraw the pane, `reportSize()`. No animation; nothing moves
   until the reader moves it.
3. A legend: one row per conversation, **ordered by the count at `PT`**, largest first: the name (a button calling
   `pickConv`), the count at `PT`, "began *date*", and a button **Ask Claude about this conversation**, shown when `can()`:

   ```js
   UC.ask('About the conversation "' + g.name + '" inside the topic ' + D.label + ': what is it about, and what should I read first? Its most typical items: ' + g.typical.map(function (i) { return i.title + ' (' + i.url + ')'; }).join('; ') + '. (get_topic_items with topic ' + D.slug + ' and conversation ' + g.id + ' lists all of them.)');
   ```

4. The line of step 3 about who grouped and who named.

**Edit 4, `pickConv(id)`.** `T.conv = T.conv === id ? '' : id; tab = 'talk'; renderTabs(); loadItems(true); UC.tell();`

**Edit 5, Talk.** In `talkPane`, above the kind buttons, a chip when `T.conv`: "Showing *name* · " and a button *clear* that
sets `T.conv = ''` and reloads. In `loadItems`, the arguments of `get_topic_items` gain `conversation: T.conv` when it is set.

**Edit 6, the shell.** `contextText()` adds `', in the conversation "' + name + '"'` on the Talk tab when `T.conv`, and on the
Conversations tab `', looking at its conversations up to ' + <the time in words>` when `PT < D.prism.to`. `siteUrl()` adds
`conv=<id>` on Talk. Both feed `UC.tell()`, which is already called on a tab change; call it after the slider's `change` event
(not `input`, so a drag tells the model once).

**The constant.** `TOPIC_UI = 'ui://undercurrent/topic-v5.html'`.

**The tests** (`test/hubviews.test.mjs`): the hub's script still parses; add

```js
it('the hub draws the conversations from the layout it is given and filters Talk by one', () => {
  const s = script(hub);
  for (const part of ['convPane', 'D.prism.layout', 'conversation: T.conv', 'Ask Claude about this conversation']) assert.ok(s.includes(part), part);
  assert.doesNotMatch(s, /Math\.(cos|sin)/, 'the geometry is the server\'s');
});
```

and extend the list in *the hub asks only for what the server offers* only if a new tool name appears (none does).

### Done when

- `npm run check` passes.
- In the fake host (section 13 of [SPEC-A10-shell.md](SPEC-A10-shell.md)) with a `get_topic` answer that has a `prism`: the tab
  shows; the petals draw in light and dark and at 390 px; dragging the slider to the start empties the petals and reorders the
  legend; a petal opens Talk with the chip and one `get_topic_items` call carrying `conversation`; a dot opens the item panel and
  Back returns to the tab; the model is told once per change.
- With an answer without `prism` there is no tab and nothing else changed.
- **In the Claude app** (the owner, after a deploy, connector reconnected, new chat): "show me the topic X" for a topic that has
  conversations draws the hub with the tab.

## 10. Step 6: documents and the smoke test

- `docs/mcp.md`: `get_topic` (`prism` in `structuredContent` with its shape, the text section); `get_topic_items`
  (`conversation`); the Topic hub's paragraph (the tab, the slider, `topic-v5`).
- `docs/architecture.md`: `conv` in the row of `/t/<slug>`; `signal/prism.ts` in the code map; the table `topic_prism`; **Topic
  conversations** in the table of model calls, next to *Topic summaries*.
- `docs/flows.md`: a step after *Summaries* in the daily flow: what is grouped, when a name is asked for, what the cap does.
- `docs/ux-proposals.md`, under **Built**, an entry **B6** with the *Not done* list of [section 13](#13-not-in-this-work).
- `docs/SPEC-ux-proposals.md`: in the B6 section, one line at the top pointing here; in F7, the Topic hub's row.
- `scripts/smoke.mjs`: request `/t/<a topic>?conv=c1` once and expect 200 (it is 200 with or without such a conversation).
- The page `/agent`: `get_topic_items`' line gains "or one conversation".

## 11. Edge cases

| Case | What happens |
| --- | --- |
| Topic detection by a model is off | No vectors, so `prismWake()` is 0, no rows, no picture anywhere. Nothing says so on the page |
| Fewer than 30 items with a vector, or no stable groups | A `none` row; no picture and no line |
| The daily cap is reached, or the model fails | The grouping is still made. Names are by rule (a title in quotation marks) and asked for again tomorrow |
| A Signal that does not show its sources | Petals, names and counts. No dots, no typical items, and `?conv=` narrows nothing because Talk shows no items there; the chip is not shown |
| An item with no web address | It has no public id: counted in its group, no dot, not in a narrowed list |
| `?conv=` with an id of yesterday that is gone, or nonsense | Dropped; the plain list. Never an error |
| Today's row is not written yet (early in the day) | Yesterday's row is used, counted over today's items. Groups that have lost all their items are dropped; under two groups, no picture |
| The topic's name changed, or it was merged into another | The row is keyed by the topic's address. A new address starts with no earlier day: new ids, new names |
| A conversation splits in two | The larger part that still holds 60% of the shared items keeps the id and name; the other part is new and is named |
| Two of yesterday's groups merge | The merged group takes the id of the one it shares most with; the other id is not used again |
| Politics | Nothing special: a politics Signal's topics are in `activeTopics()` like any other, and the page takes `?area=politics` as today |

## 12. After the first deploy: check the numbers

Do this after step 2 is deployed and before step 3. It costs a few minutes a day for three days.

1. Open `/admin/mon/prism-status` (signed in as the owner). For each active topic it gives how many items were grouped, how many
   groups, and the stability.
2. **How many topics get a picture.** With the bar at 0.7 the trial data suggests a minority: specific stories with sides, and
   topics that are really two subjects under one name. If nearly every topic has one, or none ever does, the bar is wrong for
   production text. Do not move it by feel: take the item texts of five such topics (the admin panel's Signal items), make their
   vectors as in [section 5](#how-the-fixture-was-made), and read `stability()` for 2 and 3 groups as the header of
   `prism.ts` did.
3. **Whether the groups mean something.** For three topics that have groups, read `/t/<slug>.json` → `prism.groups[].typical`.
   The five typical titles of a group should be about one thing, and two groups about different things. In the trial they were
   (for one story: the patches, how the exploit works, whether it is overblown).
4. **Whether ids stay.** The same topic on two days in a row should keep its ids and names. If an id changes while the
   conversation plainly did not, report it with both days' rows.
5. **The names.** They should be one to four plain words. A name that repeats the topic's name, or two names that say the same,
   is a prompt problem: fix the prompt in `prismSystem()`, not the cleaning.

What to do with what is found:

| Seen | Change |
| --- | --- |
| Pictures on broad topics whose groups mean nothing | Raise `PRISM_STABLE_MIN` (0.75) |
| No picture on topics that plainly have sides | Lower it (0.65), or the texts are too short to tell them apart: check a few vectors first |
| A topic flickers between a picture and none | Lower `PRISM_STABLE_KEEP` a little (0.5) |
| Groups of 4 or 5 items that are noise | Raise `PRISM_GROUP_MIN` |

Each such change gets its measured reason into the comment above the constant, as the others have.

## 13. Not in this work

Say these under *Not done* in the Built entry.

- **No picture on the landing page, in search or in a briefing.** Prism is on the topic page and in the Topic hub.
- **The conversations cover the items Talk lists** (the Signal's window, 7 days today), not 14 days. When A5 part 2 widens
  `get_topic_items` to 14 days, Prism can follow by grouping `wide` and narrowing the wider list.
- **No time slider on the site.** The page's picture is still; the slider is in the hub. The dots' place already says what came
  first.
- **A conversation has no page and no history of its own.** It is a filter of the topic for today's groups. An address with
  `conv` is good for as long as that group lives.
- **Items read before topic detection by a model was switched on have no vector** and are in no conversation.
- **The names are in English**, whatever the language of the items.
- **Nothing is done for the owner's private views.**
- **The bar was set on a small sample.** Three real topics, one written one and four mixtures of them, titles only.
  [Section 12](#12-after-the-first-deploy-check-the-numbers) is the check.
