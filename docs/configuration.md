# Configuration

Everything you can set: secrets, variables, and the options in the app. Step-by-step setup is in [deployment](deployment.md).

## Secrets (`npx wrangler secret put NAME --env=""`)

`--env=""` means the production Worker; use `--env staging` for staging. See [deployment.md](deployment.md#how-to-deploy).

| Secret | Needed for |
| --- | --- |
| `TWITTERAPI_IO_KEY` | All tweet data. Required. |
| `TEAM_DOMAIN`, `POLICY_AUD` | From your Cloudflare Access application: `<team>.cloudflareaccess.com` and the audience (AUD) tag. If either is missing, every request is refused. Required. |
| `MCP_POLICY_AUD` | The audience tag of the separate Access application for `/mcp`. If missing, `/mcp` refuses every request. Optional. |
| `OPENROUTER_API_KEY` | Summaries, briefings, History analysis, and screening. Without it these are switched off. |
| `REPLICATE_API_TOKEN` | Audio versions and briefing pictures. Without it they are not offered. |
| `ANTHROPIC_API_KEY` | Only if `SUMMARY_PROVIDER` is `anthropic`. |
| `YOUTUBE_API_KEY` | A YouTube Data API key. When a channel's public feed fails (YouTube sometimes answers 404 for all of them for days), its videos are read through the API instead: 1 quota unit a check, 10,000 free a day. Optional. How to get one: [deployment.md](deployment.md#youtube-through-the-api-when-youtubes-feeds-fail). |
| `CF_ANALYTICS_TOKEN` | The token of a Cloudflare Web Analytics site. The public pages then load its beacon (page views, no cookies). Without it they load no script at all. Optional. Where to find it: [deployment.md](deployment.md#visitor-statistics-cloudflare-web-analytics). |

## Variables (`wrangler.jsonc` → `vars`)

| Variable | Default | Meaning |
| --- | --- | --- |
| `SUMMARY_PROVIDER` | `openrouter` | Provider for summaries and briefings: `openrouter`, `anthropic`, or `workers-ai` (needs an `AI` binding, which has been removed). |
| `SUMMARY_MODEL` | `anthropic/claude-haiku-5.5` | The default writing model. Topics and the Summarize tab can pick another from the list. |
| `SUMMARY_SCREEN_MODEL` | unset | Screening: unset uses Decider Flash when OpenRouter is available, `off` disables it, or set the Decider id for the more accurate model. |
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

Bindings in `wrangler.jsonc`: the five Durable Objects, the R2 bucket `AUDIO` (create it once with
`npx wrangler r2 bucket create tweet-explorer-audio`), and the static `ASSETS`.

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

**Briefing topic** (`/admin` → Briefing setup; what it has written is under Briefings)

| Setting | Meaning |
| --- | --- |
| Address | `/<address>` on the public site (reserved: `admin*`, `custom*`, `history`, `lists`, `signal`, `report`, `audio`, `image`, `api`, `feed`, `rss`, `robots`, …). |
| Sources | Searches, your Lists, X Lists, X List groups, or the Monitor feed. |
| Instruction, Length | What to write about, and how long. |
| Model | Overrides `SUMMARY_MODEL`. |
| Schedule | Every 6, 12, 24 or 48 hours, or weekly, from a UTC hour. |
| Data budget | A cap on twitterapi.io spend per run. Also editable for every briefing at once under Budgets. |
| Auto-publish, Listed | Publish at once or keep a draft; show on the landing page or only by link. |
| Audio, Picture | A template (voice, style, model; image model, shape, prompt), made automatically or by hand. |
| Signal | Also count the posts this briefing fetches in Signal (free), as a group of this name (starts at weight ×2). |

**Sources** (`/admin` → Sources): every watch (X account or search, RSS, YouTube, Hacker News, or a whole list), how often it is checked, its Signal
group, pause and delete, and desktop notifications. New items show in Live feed.

**Signal setup** (`/admin` → Signal setup): sources and the group each votes in; group weights (0 mutes, 3 triples); topic rules (words or AI,
the model, filtered words, and hide, merge or rename a topic, which applies everywhere and also to what was counted before); and the top-level
Signals, each with its groups, its public address, and whether it is published and shows its sources.

**Budgets** (`/admin` → Budgets): the daily cap for X data (watches), the daily cap for Signal topics by AI, and each briefing's data budget per
run, each next to what has been spent.

**Retrying and re-running**: see [deployment.md](deployment.md#retrying-and-re-running).

---

## Costs

Everything that spends goes into the ledger on the **Costs** tab: Search, Users and Lists, History collection, History analysis (split into the cheap
and the stronger model), Monitor, the Summarize tab, scheduled briefings (with audio and pictures). Tweet data is billed per tweet returned
(about $0.15 per 1,000); models by tokens at the list prices in `src/summarize/openrouter.ts` and `src/decisions.ts`; Replicate by the prices in `src/replicate.ts`.
Estimates are shown before anything large starts, and History collections, analyses and briefings each have a cap you set.
