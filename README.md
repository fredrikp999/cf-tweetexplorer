# Tweet Explorer

[![CI](https://github.com/fredrikp999/cf-tweetexplorer/actions/workflows/ci.yml/badge.svg)](https://github.com/fredrikp999/cf-tweetexplorer/actions/workflows/ci.yml)

Follow what is being said on X, in news and blog feeds, on YouTube and on Hacker News; have language models turn it into short briefings; and see,
across all of it, which topics are talked about and where. It runs as a single [Cloudflare Worker](https://developers.cloudflare.com/workers/)
with Durable Objects: a private admin app, a public site (published as **Agent Cortex**), and an MCP server for the Claude app.

## What it does

**Sources.** X accounts, searches, account lists and X Lists (through [twitterapi.io](https://twitterapi.io), paid per tweet); RSS and Atom feeds,
YouTube channels and Hacker News (free). Sources are watched on a schedule and managed per list, with retries per list or per source. YouTube
channels whose public feed fails are read through the YouTube Data API when a key is set.

**Briefings.** Topics written on a schedule by a language model from the sources you choose, kept as drafts or published at once, with an optional
audio version and picture. Each briefing has a TL;DR, "In brief", and one section per theme, marked new or continuing from the day before, with
the accounts it cites and the Signal topics it touches. A run can be retried, or re-run over the latest issue after a change of settings.

**Signal.** Everything watched, combined into one score per topic: each group of sources votes by the share of its items that mention a topic,
weighted, so a busy group cannot drown a small one. Topics are words and phrases, or named by a language model ("scribd breach", not "scribd").
Always-present topics are left out unless they spike; engagement bait is not counted; topics can be merged and renamed. Several Signals can be
published, each with its own page, a page per topic, and optionally the items behind each topic.

**Feed pages.** Public pages that show items from what is watched, defined in the admin: for example the latest video of each channel in a
list, with the newest one playing, or the most reacted articles of the week. Their newest items also appear on Today.

**Archives.** Collect every tweet for a search over weeks or years, read the statistics, run an AI analysis (themes, stance toward subjects,
a written summary) and publish it as a report.

**Explore.** Search X, look up an account, see what is trending, and ask an agent to summarize a list, a search or a feed on demand.

**Costs.** One ledger of everything that spends money (X data, text models, speech, pictures), budgets for each, and an Overview that lists
what failed or waits, with a button to retry each.

## The three parts

| | Who | What |
| --- | --- | --- |
| **Public site** `/` | Anyone | **Today** (each briefing's headline and themes), one page per briefing topic with its earlier days and an RSS feed, **feed pages** ("Watch and read"), **Signal** with a page per topic, **Topics** (every topic Signal found, new, rising and A to Z, searchable), and how it works, published reports, and the lists behind the briefings. Readers can report an error in any theme. Server-rendered, no cookies; the only script is optional Cloudflare Web Analytics. |
| **Admin** `/admin` | You, behind Cloudflare Access | **Overview** (what needs attention, with fixes), then **Day to day**: Signal, Live feed, Briefings, Archives, Costs; **Explore**: Find tweets, Look up account, Trending, Ask AI; **Setup**: Sources, Signal setup, Briefing setup, Lists & templates, Feed pages, Budgets. Viewing and configuration are kept on separate pages. |
| **MCP server** `/mcp` | Service tokens, behind its own Access application | Read-only tools for briefings, Signal, archives, lists, the live feed and costs. In the Claude app, `get_signal` and `get_costs` open as interactive dashboards. |

Language models come from [OpenRouter](https://openrouter.ai) (Anthropic directly also works for summaries), and audio (Gemini TTS) and
pictures from [Replicate](https://replicate.com). Everything except X data is optional.

## Quick start

You need Node.js 22.18 or newer and a [twitterapi.io](https://twitterapi.io) key.

**Run the Worker locally** (the code that is deployed: everything above)

```sh
npm install
npm run types                 # generates worker-configuration.d.ts from wrangler.jsonc
cp .dev.vars.example .dev.vars
npm run dev
```

**Run the local Node app** (the same admin page served by Node, with only what does not need the Worker: Explore, Lists, Live feed, Archives
and Ask AI, plus an Agent tab and posting as your X account, which exist only locally; no briefings, Signal, public site or MCP)

```sh
cp .env.example .env          # add TWITTERAPI_IO_KEY (and OPENROUTER_API_KEY for summaries)
npm start                     # http://localhost:3000
```

**Deploy to Cloudflare**: see [docs/deployment.md](docs/deployment.md). In short:

```sh
npx wrangler login
npx wrangler secret put TWITTERAPI_IO_KEY --env=""
npx wrangler secret put OPENROUTER_API_KEY --env=""
DEPLOY_DOMAIN=tweets.example.com npm run release     # check, deploy, then smoke-test the live site
```

Then protect `/admin*` with a Cloudflare Access application and store its team domain and audience tag as the secrets `TEAM_DOMAIN` and
`POLICY_AUD` (`--env=""`). Until that is done every request to `/admin` is refused. Nothing about your account or domain is kept in the
repository: the domain is given at deploy time and the rest are secrets. A `staging` environment (`npm run staging`) deploys a second Worker
with its own data on workers.dev.

## Documentation

| | |
| --- | --- |
| [Architecture](docs/architecture.md) | How it is deployed, public and private routes, the Durable Objects, the code map, which models are used |
| [Flows](docs/flows.md) | What happens for archives, AI analysis, Ask AI, briefings, screening and the live feed, step by step |
| [Configuration](docs/configuration.md) | Secrets, variables, and every setting in the app (Sources, Signal setup, Briefing setup, Budgets) |
| [Deployment](docs/deployment.md) | How to deploy (release, smoke test, staging), retrying and re-running, and setup one feature at a time: Access, briefings, audio, pictures, archives, MCP, YouTube API, analytics, reader reports |

## Project layout

```
src/            The Cloudflare Worker
  index.ts        Routing: public site, /admin (Access), /mcp
  durable-objects/  Monitor (sources, live feed, Signal), Publish (briefings), History (archives), Lists, Cost (ledger)
  signal/         Signal: terms, scoring, topics, AI topic names, filters
  site/           The public site (server-rendered HTML), Markdown, briefing structure
  summarize/      The writing agent, model providers, screening, pricing
  sources/        X, RSS, YouTube, Hacker News, feed lists
  history/        Archive statistics and AI analysis
  media/          Audio (text to speech) and pictures for briefings
  llm/, lib/      Model calls, cost recording, shared helpers
  apps/           The MCP App views (Signal and Costs dashboards); mcp.ts registers the tools
public/admin/   The admin app (a single HTML page, no build step)
server/         The local Node app
scripts/        smoke.mjs: the smoke test run after each release
test/           Tests (node --test)
docs/           Documentation
```

## Development

```sh
npm run typecheck             # TypeScript
npm test                      # node --test, no extra dependencies
npm run check                 # both
npm run build                 # bundle the Worker without deploying
npm run smoke -- https://tweets.example.com   # check a deployed site (reads only)
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Licensed under the [MIT License](LICENSE).
