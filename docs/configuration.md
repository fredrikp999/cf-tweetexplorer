# Configuration

Everything you can set: secrets, variables, and the options in the app. Step-by-step setup is in [deployment](deployment.md).

## Secrets (`npx wrangler secret put NAME --env=""`)

`--env=""` means the production Worker; use `--env staging` for staging. See [deployment.md](deployment.md#how-to-deploy).

| Secret | Needed for |
| --- | --- |
| `TWITTERAPI_IO_KEY` | All tweet data. Required. |
| `TEAM_DOMAIN`, `POLICY_AUD` | From your Cloudflare Access application: `<team>.cloudflareaccess.com` and the audience (AUD) tag. If either is missing, every request is refused. Required. |
| `MCP_POLICY_AUD` | The audience tag of the separate Access application for `/mcp`. If missing, `/mcp` refuses every request. Optional. Setup: [mcp.md](mcp.md#signing-in). |
| `OPENROUTER_API_KEY` | Summaries, briefings, History analysis, and screening. Without it these are switched off. |
| `REPLICATE_API_TOKEN` | Audio versions, the Replicate picture models, and the fallback for the Workers AI picture models. Without it audio is not offered and the Workers AI pictures have no fallback. |
| `AI_GATEWAY_TOKEN` | A Cloudflare API token with the permission **AI Gateway → Run**, so OpenRouter calls may pass through the gateway named in `AI_GATEWAY` (whose authentication is on). Without it, or if the gateway refuses it, OpenRouter is called directly. Optional. |
| `ANTHROPIC_API_KEY` | Only if `SUMMARY_PROVIDER` is `anthropic`. |
| `YOUTUBE_API_KEY` | A YouTube Data API key. When a channel's public feed fails (YouTube sometimes answers 404 for all of them for days), its videos are read through the API instead: 1 quota unit a check, 10,000 free a day. Optional. How to get one: [deployment.md](deployment.md#youtube-through-the-api-when-youtubes-feeds-fail). |
| `SITE_POLICY_AUD` | The audience (AUD) tag of the Access application in front of the whole site (the Google login). With it the site knows who is reading: readers keep settings, and roles can give them Ask Claude. Without it the site is the same for everyone. Optional. See [deployment.md](deployment.md#readers-settings-and-roles). |
| `MOVED_HOSTS` | Domains the site moved away from, as `old.example.com=new.example.com` (several separated by commas). A request to an old domain is redirected (308) to the same path on the new one. Optional. See [deployment.md](deployment.md#moving-to-another-domain). |
| `CF_ANALYTICS_TOKEN` | The token of a Cloudflare Web Analytics site. The public pages then load its beacon (page views, no cookies). Without it they load no script, apart from the two picture pages. Optional. Where to find it: [deployment.md](deployment.md#visitor-statistics-cloudflare-web-analytics). |

## Variables (`wrangler.jsonc` → `vars`)

| Variable | Default | Meaning |
| --- | --- | --- |
| `SUMMARY_PROVIDER` | `openrouter` | Provider for summaries and briefings: `openrouter`, `anthropic`, or `workers-ai` (uses the `AI` binding). With the binding present, Workers AI models are also offered in the Summarize model picker. |
| `SUMMARY_MODEL` | `anthropic/claude-haiku-5.5` | The default writing model. Topics and the Summarize tab can pick another from the list. |
| `SUMMARY_SCREEN_MODEL` | unset | Screening: unset uses Decider Flash when OpenRouter is available, `off` disables it, or set the Decider id for the more accurate model. |
| `AI_GATEWAY` | `default` | The Cloudflare AI Gateway that OpenRouter calls and Workers AI pictures pass through, for its logs and analytics. `default` is created on first use. Remove it to call everything directly. See [deployment.md](deployment.md#ai-gateway). |
| `SUMMARY_MOCK` | | Local only (`.dev.vars`): scripted answers instead of model calls. Never active for requests through Cloudflare's edge. |
| `DEV_BYPASS_ACCESS` | | Local only: skips the Access check under `wrangler dev`. |

### YouTube transcripts

The Summarize agent's `get_video_transcript` tool returns what is said in a YouTube video the agent was shown. These are optional variables (set
them in `wrangler.jsonc` → `vars`, or in `.dev.vars` locally); with none set, the free default is used.

| Variable | Default | Meaning |
| --- | --- | --- |
| `TRANSCRIPT_PROVIDER` | `captions` | `captions`: the video's own public caption track. Free, but unofficial: YouTube may refuse requests from cloud addresses, and videos without captions have none. `openrouter`: a Gemini model reads the video from its YouTube address (needs `OPENROUTER_API_KEY`; billed per token). `replicate`: a speech-to-text model takes the video address (needs `REPLICATE_API_TOKEN`; billed per second of compute). |
| `TRANSCRIPT_FALLBACK` | unset | `openrouter` or `replicate`: tried only when `TRANSCRIPT_PROVIDER` fails. This is the way to keep the free default and still get a transcript when YouTube refuses the captions. |
| `TRANSCRIPT_MODEL` | `google/gemini-2.5-flash` | The OpenRouter model for `openrouter`. It must accept video input; Gemini models do, for YouTube addresses. |
| `TRANSCRIPT_REPLICATE_MODEL` | `adidoes/whisperx-video-transcribe` | The Replicate model for `replicate`. It must take the video address as an input called `url` and return text, or JSON with `segments` (`text`, `start`). |
| `TRANSCRIPT_REPLICATE_USD_PER_SEC` | `0.001` | A rough price per second of compute, to estimate the cost shown in Costs. Set it to what your Replicate invoice shows. |

A transcript from a paid service is recorded in the Costs tab under **Summarize tab** as "Video transcripts (openrouter|replicate)". Captions cost nothing.
A run can read at most 5 pages, comment threads and transcripts together, and the text is capped at 12,000 characters by default.

Bindings in `wrangler.jsonc`: the six Durable Objects, the R2 bucket `AUDIO` (create it once with
`npx wrangler r2 bucket create tweet-explorer-audio`), Workers AI (`AI`, for the picture models, the embedding model and the gateway), the version metadata, and the static `ASSETS`.

## Settings in the app

**History job** (`/admin` → History)

| Setting | Meaning |
| --- | --- |
| Query | A search (`from:`, `$TICKER`, `"phrase"`…). Optional when you pick lists. |
| Only these lists / X lists | Limit the search to accounts in your lists, or to X Lists. |
| From / To | The period (To is inclusive). |
| Shard size | The time window each request covers: Auto (probe), 15 min to 1 week. |
| Min likes, Lang, no replies, no retweets | Filters applied in the search. |
| Parallel | How many shards are read at once. |
| Stop after ≈ tweets | The cap that bounds the cost (checked as shards finish a page). |

**AI analysis**

| Setting | Meaning |
| --- | --- |
| Themes, Subjects | What to label (up to 12 themes, 6 subjects), or suggested by AI. Changing them discards the labels. |
| Cheap model | Labels everything. A chat model, or a Perplexity Decider (cheapest, one tweet per request). |
| Stronger model | Re-checks, proposes themes, writes the summary. Never a Decider. |
| Re-check unsure labels | 0 to 30% of the tweets. |
| Budget | The run stops here and can be resumed (default $2). |
| Label at most | A stable sample beyond this many unique tweets (default 20,000). |
| Show on the public report | Adds the analysis to the published report. |

**Briefing topic** (`/admin` → Briefings → Settings; what it has written is under Issues)

| Setting | Meaning |
| --- | --- |
| Address | `/<address>` on the public site (reserved: `admin*`, `custom*`, `history`, `lists`, `signal`, `report`, `audio`, `image`, `api`, `feed`, `rss`, `robots`, …). |
| Sources | Searches, your Lists, X Lists, X List groups, or the Monitor feed. The editor shows an estimate of what collecting them costs. |
| Instruction, Length | What to write about, and how long. |
| Model | Overrides `SUMMARY_MODEL`. |
| Schedule | Every 6, 12, 24 or 48 hours, or weekly, from a UTC hour. |
| Data budget | A cap on twitterapi.io spend per run. Also editable for every briefing at once under Budgets. |
| Auto-publish, Listed | Publish at once or keep a draft; show on the landing page or only by link. |
| Area | AI (default) or Politics. A politics briefing shows under `/politics` (In brief, `/politics/briefings`, the menu) and never on the AI pages; its own address (`/<slug>`) does not change. Stored in the topic (`area`, none stored means AI). The slug `politics` (and `agent`, `search`) is reserved for new topics; a briefing already called `politics` is hidden by the area page at `/politics`, so rename it. |
| Audio, Picture | A template (voice, style, model; image model, shape, prompt), made automatically or by hand. |
| Signal | Also count the posts this briefing fetches in Signal (free), as a group of this name (starts at weight ×2). |

**Sources** (`/admin` → Sources): what is watched, managed per list. Each feed list, account list and X List is one card: how often its sources
are checked, its Signal group, counted in Signal or not, pause or resume all, check all (or retry only the failing ones), and stop watching. A card
also says when the list has sources that are not watched, or accounts that changed, with a button to bring the watches in line. Open a card to see
its sources one by one, each with its status, last error, its own interval and **Retry / Check now**, Pause and Remove. Sources added on their own
are grouped by kind (X, RSS, YouTube, Hacker News) and handled the same way, and lists that exist but are not watched are listed with a **Watch**
button. Desktop notifications are set here too. New items show in Live feed.

**Research pulse** (`/admin` → Signal → Setup and publishing): the research topics and the arXiv search behind each, public at `/research`. Changing a search starts its history again. See [flows](flows.md).

**Signal setup** (`/admin` → Signal → Setup and publishing): sources and the group each votes in; group weights (0 mutes, 3 triples); topic rules (words or AI,
the model, filtered words, the topic names suggested as one by meaning, and hide, merge or rename a topic, which applies everywhere and also to what was counted before); and the top-level
Signals, each with its groups, its public address, its **Area** (AI, the default, or Politics) and whether it is published and shows its sources. The area decides where it shows: an AI Signal on the AI pages, a Politics Signal under `/politics`; the landing page of an area takes its numbers from the first published Signal of that area. Stored in the board (`area`, none stored means AI), so nothing needs migrating.

**Feed pages** (`/admin` → Feed pages): public pages at `/feeds/<address>` that show items from what is watched. Each has a name, an address and a
line under the name; **From** (everything, all sources of one kind, or one feed list, account list or X List); **Only** (one kind: YouTube videos,
RSS articles, Hacker News stories or X posts); **Show** the newest or the most reacted, how many (1 to 50) and from how many days (1 to 30);
**only the newest from each source** (for example the latest video of each channel); **Layout**: the first video playing with the rest as cards,
cards with pictures, or a plain list; whether it is published, and whether its newest item is on Today under "Watch and read". **Preview** shows
what it would show. A list must be watched under Sources to show up; nothing extra is fetched or paid for.

**Budgets** (`/admin` → Budgets): the daily cap for X data (one cap for all recurring X collection: watches and briefings, briefings first), the daily cap for Signal topics by AI, and each briefing's data budget per
run, each next to what has been spent.

**Collection** (`/admin` → Collection): the mode (Comparing, Collected data, Live only), the status of each source (health, limit hit, used by, cost per briefing), *Collect now* (a fresh read, not reused), the comparisons of live against the store, unused sources, feed list members with no watch (one click to add), and a browser of everything collected. Items are kept 90 days.

**Retrying and re-running**: see [deployment.md](deployment.md#retrying-and-re-running).

---

**Readers** (`/admin` → Readers): everyone the site's login has let in, with when they were last seen, their questions today and in 7 days, what
those cost, and how many lenses and followed topics they keep. Give each a **role**, and extra features on top. **Roles**: Reader is everyone's and
gives nothing; the others are yours to name, each with features (now: Ask Claude) and a number of questions a day (1 to 200). An address can be given
a role before its first visit. **Forget** deletes everything kept about a reader. Who may sign in at all is set in Cloudflare Access, not here.

**Lenses** (`/admin` → Signal → setup → Lenses)

The card has an **Area** chooser (AI, Politics): each area has its own lenses, colours (one lens per colour within an area), starting set and suggestions (the model sorts the topics of that area's Signals only).

| Setting | Meaning |
| --- | --- |
| Name, key, one line | What readers see; the key is the address (`?lens=security`) and cannot change once saved. |
| Colour | One of six, each used by one lens per area. |
| Starting lenses | An area that was never saved gets its own once: AI has Security, Agentic engineering, Observability, Data, Models; Politics has Elections, Economy, War and security, Law and rights, Climate and energy (`seedLenses`). Change or delete them freely. |
| Terms | Topic names and words, one per line. A topic is in the lens when a term is its name or whole words of it. |
| Suggest topics | Asks the Signal topic model which current topics belong where; you tick what to add. Costs a few cents inside the daily cap (Costs: "Lens suggestions (AI)"). |

## Costs

Everything that spends goes into the ledger on the **Costs** tab: Search, Users and Lists, History collection, History analysis (split into the cheap
and the stronger model), Monitor, collection (kind `collect`, per source), the Summarize tab, scheduled briefings (with audio and pictures). Tweet data is billed per tweet returned
(about $0.15 per 1,000). A shared source's cost is split evenly between the briefings that read it in issue costs and topic stats; the ledger totals count it once; models by tokens at the list prices in `src/summarize/openrouter.ts` and `src/llm/decisions.ts`; Replicate by the prices in `src/media/replicate.ts`.
Workers AI pictures are recorded at $0 (they stay inside the free daily Neurons), with the model that made them and a note when a fallback was used.
Estimates are shown before anything large starts, and History collections, analyses and briefings each have a cap you set.

## Embedding costs

No setting and no separate vector database: vectors are rows in the Monitor Durable Object's SQLite (see [flows](flows.md#meaning-embeddings)).

| What is embedded | Costs line | Size |
| --- | --- | --- |
| Research map papers | "Research map" | See below. |
| Every item the Signal topic model reads (only when topics by AI are on) | "Signal items (meaning)" | About 75 tokens an item: at about 700 items a day, under a cent a day. 1.5 KB of vector per item, kept 30 days (about 30 MB). |
| Topic names in use, once each | "Signal topic names (meaning)" | A few tokens a name; up to 200 new names a batch at first, then only new ones. |
| A briefing's posts, once per run | "*Briefing name* (posts compared)" | Up to a few hundred posts a run: a small fraction of a cent. |

The copy and name thresholds are constants in `src/signal/vectors.ts`, not settings. **Signal setup → Topic detection** shows what they do: the
posts counted as copies, with the newest of them, and the topic names suggested as one (merge or dismiss each).

**Research map.** Measured on 3,504 papers: about 1.3M tokens to embed the first month (about 2,400 of the 10,000 free Neurons a day, or $0.026 if paid), then about 120 papers a day, and 5.4 MB of vectors. Naming is one model call a day through OpenRouter, recorded under Signal topics as "Research map (names)".

## Embeddings and Cloudflare storage in Costs

Embeddings are recorded at list price (kind `embedding`), before the free daily Neurons, which image generation shares. The tokens are estimated from the text length, as the embedding model reports no count.

Storage (kind `storage`) is measured once a day, by Monitor's daily wake-up or whoever opens Costs first. It asks this app's six Durable Object databases for their size and adds up the R2 bucket, so it needs no API token. Each day adds one day at list price (`src/lib/storagePrices.ts`), before the 5 GB of databases and 10 GB of R2 that the plan includes, and the Costs tab also shows what a month at this size would be billed after those. The ledger starts at the first measurement. It covers this Worker only: not the staging Worker or anything else on the account, not rows read or written, not R2 operations, and not the plan's monthly fee. The Cloudflare dashboard has the real bill.
