# Configuration

Everything you can set: secrets, variables, and the options in the app. Step-by-step setup is in [deployment](deployment.md).

## Secrets (`npx wrangler secret put NAME`)

| Secret | Needed for |
| --- | --- |
| `TWITTERAPI_IO_KEY` | All tweet data. Required. |
| `TEAM_DOMAIN`, `POLICY_AUD` | From your Cloudflare Access application: `<team>.cloudflareaccess.com` and the audience (AUD) tag. If either is missing, every request is refused. Required. |
| `OPENROUTER_API_KEY` | Summaries, briefings, History analysis, and screening. Without it these are switched off. |
| `REPLICATE_API_TOKEN` | Audio versions and briefing pictures. Without it they are not offered. |
| `ANTHROPIC_API_KEY` | Only if `SUMMARY_PROVIDER` is `anthropic`. |

## Variables (`wrangler.jsonc` → `vars`)

| Variable | Default | Meaning |
| --- | --- | --- |
| `SUMMARY_PROVIDER` | `openrouter` | Provider for summaries and briefings: `openrouter`, `anthropic`, or `workers-ai` (needs an `AI` binding, which has been removed). |
| `SUMMARY_MODEL` | `anthropic/claude-haiku-5.5` | The default writing model. Topics and the Summarize tab can pick another from the list. |
| `SUMMARY_SCREEN_MODEL` | unset | Screening: unset uses Decider Flash when OpenRouter is available, `off` disables it, or set the Decider id for the more accurate model. |
| `SUMMARY_MOCK` | | Local only (`.dev.vars`): scripted answers instead of model calls. Never active for requests through Cloudflare's edge. |
| `DEV_BYPASS_ACCESS` | | Local only: skips the Access check under `wrangler dev`. |

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

**Briefing topic** (`/admin` → Briefings)

| Setting | Meaning |
| --- | --- |
| Address | `/<address>` on the public site (reserved: `admin*`, `custom*`, `history`, `lists`, `audio`, `image`, `api`, `feed`, `rss`, `robots`, …). |
| Sources | Searches, your Lists, X Lists, X List groups, or the Monitor feed. |
| Instruction, Length | What to write about, and how long. |
| Model | Overrides `SUMMARY_MODEL`. |
| Schedule | Every 6, 12, 24 or 48 hours, or weekly, from a UTC hour. |
| Data budget | A cap on twitterapi.io spend per run. |
| Auto-publish, Listed | Publish at once or keep a draft; show on the landing page or only by link. |
| Audio, Picture | A template (voice, style, model; image model, shape, prompt), made automatically or by hand. |

---

## Costs

Everything that spends goes into the ledger on the **Costs** tab: Search, Users and Lists, History collection, History analysis (split into the cheap
and the stronger model), Monitor, the Summarize tab, scheduled briefings (with audio and pictures). Tweet data is billed per tweet returned
(about $0.15 per 1,000); models by tokens at the list prices in `src/summarize/openrouter.ts` and `src/decisions.ts`; Replicate by the prices in `src/replicate.ts`.
Estimates are shown before anything large starts, and History collections, analyses and briefings each have a cap you set.
