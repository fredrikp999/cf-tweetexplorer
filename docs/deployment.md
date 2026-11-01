# Deployment

How to deploy the Worker to Cloudflare (the examples use `tweets.example.com`; use a domain on your Cloudflare account), and the setup each feature needs.

The site has three parts:
- **Public** (no login): `/` is **Today** (each briefing's headline and themes, and what Signal says is talked about now); `/<topic>` a topic's
  latest briefing, `/<topic>/<date>` an earlier one, `/<topic>/archive` the list of earlier days, `/<topic>/feed.xml` its RSS feed;
  `/report/<topic>/<date>` the "Report an error" form; `/signal`, `/signal/<address>`, `/signal/<address>/t/<topic>` and `/signal/method` for Signal;
  `/history` for reports and `/lists` for the lists behind the briefings.
- **`/admin`** (Access): one private page, opening on **Overview** (what needs attention, with a button to fix or retry each thing). Its tabs are
  grouped by what you do there:
  - **Day to day** (viewing and acting): Signal, Live feed, Briefings (read, edit, publish, run), Archives, Costs.
  - **Explore**: Find tweets, Look up account, Trending, Ask AI.
  - **Setup** (configuration only): Sources (what is watched), Signal setup, Briefing setup, Lists & templates, Budgets (every spending limit), Post as X, Guide.

  `/admin/#costs`, `/admin/#sources` and so on open a given tab. The old `/custom` addresses redirect to `/admin`.
  Agent and Account only exist when you run the app locally (`npm start`, which serves it at `/`).
- **`/mcp`** (its own Access application): the read-only MCP server, with the Costs and Signal dashboards for the Claude app.

Everything that is not `/admin*` (or `/mcp`) is public, so new private features must live under one of those. (`/custom*` still counts as private and only redirects.)

## How to deploy

The domain is never stored in the repository, so every deploy names it. The usual way, after the one-time setup below:

```sh
DEPLOY_DOMAIN=tweets.example.com npm run release
```

`npm run release` does three things and stops at the first that fails:
1. `npm run check`: the type check and the tests.
2. Deploys production with the domain (`wrangler deploy --env="" --domain …`).
3. Runs the smoke test against the live site (below). If it fails, the deploy has already happened: fix forward, or roll back
   with `npx wrangler rollback --env=""` (it lists the earlier versions).

After a deploy:
- **Briefings and Signal pick the change up by themselves.** Nothing needs restarting. Settings live in the Durable Objects, not in the code.
- **If you use the Claude app with the MCP connector** and the deploy changed the Signal or Costs dashboard: disconnect and reconnect the connector
  (Settings → Connectors), then start a new chat. The app keeps the old view otherwise.
- New secrets are read at once; a secret set after the deploy needs no new deploy.

Other ways:
- `npm run deploy -- --domain tweets.example.com`: deploy production without the check and the smoke test.
- `npm run smoke -- https://tweets.example.com`: only the smoke test. It fetches every kind of public page (Today, each topic, a dated issue, the
  archive, the RSS feed and the report form, Signal, a Signal topic, a sorted Signal, the method page, Lists, Reports, robots.txt, a missing page),
  checks the status code and what each page must contain and its security header, and checks that `/admin` does not open without Access and that an
  old Signal address redirects. It only reads, so it is safe against the live site, and exits 1 on any failure. Pages slower than 3 s are marked.
- **Staging**: `npm run staging` deploys a second Worker, `tweet-explorer-staging`, on workers.dev, with its own Durable Objects (so its own,
  empty data) and its own R2 bucket. Once: `npx wrangler r2 bucket create tweet-explorer-audio-staging`, and the secrets it needs with
  `npx wrangler secret put NAME --env staging`. Then `npm run smoke -- https://tweet-explorer-staging.<your-subdomain>.workers.dev`.

**Environments and secrets.** `wrangler.jsonc` defines production (the top level) and `staging`. Wrangler warns when a command does not say which:
pass `--env=""` for production (`npx wrangler secret put NAME --env=""`, `npx wrangler secret list --env=""`) and `--env staging` for staging.
`npm run deploy`, `npm run release` and `npm run staging` already do.

## One-time setup
1. `npx wrangler login`
2. `grep '^TWITTERAPI_IO_KEY=' .env | cut -d= -f2- | npx wrangler secret put TWITTERAPI_IO_KEY --env=""`
3. `npm run deploy -- --domain tweets.example.com` (safe before step 4: with no Access config every request is refused with 503).
   The domain is passed on the command line, not stored in `wrangler.jsonc`, so the repository holds nothing about your account.
4. Zero Trust dashboard → Access → Applications → Add → Self-hosted:
   one destination, `tweets.example.com/admin*` (NOT the whole domain, or
   the public pages are blocked too), policy Allow for your email(s).
   An existing app for the whole domain, or with the old `/admin*` + `/custom*` pair: edit its destinations to that one (keeping `/custom*`
   as well is harmless); the AUD tag stays the same.
   Copy the **Application Audience (AUD) tag** and your **team domain** (`<team>.cloudflareaccess.com`).
5. Store both as Worker secrets, so they stay out of the repository, then deploy again:
   ```sh
   npx wrangler secret put TEAM_DOMAIN --env=""     # <team>.cloudflareaccess.com
   npx wrangler secret put POLICY_AUD --env=""      # the Application Audience (AUD) tag
   npm run deploy -- --domain tweets.example.com
   ```
   Every deploy needs the domain (`--domain`, or `DEPLOY_DOMAIN` with `npm run release`). Deploying without any domain leaves the Worker
   unreachable (`workers_dev` is off). From here on, deploy as described in [How to deploy](#how-to-deploy).

## Publishing (scheduled briefings)
In `/admin` → **Briefings** create a topic: an address (`ai` → `/ai`), one or more sources (searches, Lists, Monitor feed), an
instruction, and a schedule (every 6h to weekly, from a UTC hour). A Durable Object alarm runs it: it fetches the tweets
from the last interval, the summarizer writes an issue, and it is stored as a **draft** you approve (or published
straight away if the topic is set to auto-publish). Drafts can be edited before publishing. Public pages are cached for a minute.
- **Model per topic**: the topic form has the same model picker as the Summarize tab (OpenRouter models, with context and price). A
  topic that has no model of its own, or one that is no longer offered (older topics saved a Workers AI model), uses the site default
  (`SUMMARY_MODEL`, now `anthropic/claude-haiku-5.5`). Each issue records the model that actually wrote it. Needs the
  `OPENROUTER_API_KEY` secret (see below).
- "Run now" starts a run immediately; failures (no tweets, model quota) show under the topic as "Last run".
- Each run costs twitterapi.io credits (up to 3 pages per search source) and one OpenRouter / Anthropic call.
- Unlisted topics are reachable by link but not shown on the landing page. A topic with nothing published is a 404.
- Reserved addresses: anything starting with `admin` or `custom`, plus `api`, `robots`, `feed`, `rss`, etc.

## Audio versions (Gemini TTS on Replicate)
Each briefing can have an audio version, read aloud by [Gemini 3.8 Flash TTS](https://replicate.com/google/gemini-3.8-flash-tts) on
Replicate and shown as a player at the top of the public post (and of each day under "Previous days").

**One-time setup**
1. `npx wrangler r2 bucket create tweet-explorer-audio` (the MP3 files; the binding is `AUDIO` in `wrangler.jsonc`).
2. `npx wrangler secret put REPLICATE_API_TOKEN` (a token from replicate.com/account/api-tokens, with billing set up). Without it audio is simply not offered.
3. `npm run deploy`.

**Templates** (`/admin` → Briefings → *Audio templates*): a template is a voice plus how it is read. They are shared by all topics and
editable; five starters are included (News anchor, Conversational, Documentary, Upbeat, Quick read), and
"Restore the built-in templates" brings back any you deleted. Templates saved earlier for Fish Audio are converted to the starter voice
and a plain-words style when they are read.
- **Model**: Gemini 3.8 Flash TTS (most expressive) or Gemini 3.8 Flash-Lite TTS (cheaper; same voices and inputs, about half the
  assumed price). Existing templates stay on Flash; the *Quick read* starter uses Flash-Lite.
- **Voice**: one of Gemini's 30 studio voices (Kore, Charon, Puck, Sulafat…), each listed with its character. Age, gender and accent
  come from the voice, so change the voice rather than describing one.
- **Style**: a few plain words such as `warm and relaxed`, sent as the model's `style` input for every piece. Empty means natural
  delivery, which often works best; long directions make the voice drift.
- **Intro and outro** (with `{title} {date} {posts} {accounts}`) and **pauses** (`<short pause>` / `<long pause>`) between sections.
- **Hear a sample** makes about 450 characters with the unsaved edits, so you can tune a template before using it.

**Per topic**: the topic page has a **Make audio for <newest briefing>** button (next to *Run now*) that reads the newest briefing
aloud from the text already written: no tweets are fetched and nothing is summarized again. Choose a template, and either tick "Create the audio automatically when a briefing is written" or make it by hand with
**Make audio** on any issue (also *Remake* and *Delete audio* in the issue editor, where you can listen before publishing). Audio is
public only while its issue is published. If you edit the text afterwards the audio is flagged *out of date* (it stays up until you remake it).

**What is read**: the briefing without links, URLs, charts and code; `@name` is read as the name, tables row by row, `TL;DR` as "In short".
Square brackets, `<tags>` and `|pipes|` in the briefing are dropped, so the text can never inject its own delivery cues. Long briefings
are sent in pieces of at most 3,500 characters, each with the same voice and style.

**Cost**: Replicate bills by token (text in, about 25 audio tokens per second out). The model page publishes no price, so Flash is
calibrated on Replicate's own "approximate cost" for real runs (about $9 per million output tokens, good to roughly 10% since Replicate
rounds to cents) and Flash-Lite is assumed at half of that (`TTS_MODELS` in `src/media/replicate.ts`). A 3,000-character briefing is roughly
$0.05 on Flash and $0.02 on Flash-Lite. The real token counts of
each run are used for the cost recorded on the issue and the Costs tab ("Audio versions"); the topic form and template editor show an
estimate. Locally, `AUDIO_MOCK=1` in `.dev.vars` makes audio silent and free for testing.

## History reports (saving and publishing a History run)
A finished **History** job (`/admin` → History) can be saved as a named **report** and optionally published at `/history/<address>`:
the statistics and every collected tweet, nothing else. No setup: it reads the job's tweets already stored in the app.
- **Save as report** on a job (not while it is still running): give it a title, an address (lowercase letters, digits, hyphens) and an
  optional description, and say whether it is listed. Saving computes the statistics (tweets and accounts, likes / retweets / replies /
  views, activity over time, weekday × hour heatmap in UTC, most active accounts, hashtags, languages, most used words, linked sites)
  and an index so the public pages can sort and page quickly. **Save and publish** does both at once; **Publish** / **Unpublish** are
  on the job card, and **Delete report** removes the report but keeps the job and its tweets.
- **Public pages**: `/history` lists the published, listed reports (also in the left rail and on the landing page); a report at
  `/history/<address>` shows the statistics, then the tweets 50 to a page, newest first (`/history/<address>/new/<n>`) or most liked
  first (`/history/<address>/top/<n>`). Tweets show the author, time, text, counts and a link to the post on X, with no profile pictures
  (the public pages load nothing from other sites). Unlisted reports are reachable only by their link. Public pages update within a minute.
- **While published**, the job cannot be resumed or deleted (unpublish first), so the page never changes under readers. Resuming an
  unpublished job marks its report out of date; save it again to recompute before publishing. If a collection stopped at its tweet cap,
  the page says so (it reads newest first, so the oldest days may be thin).
- Never shown publicly: cost, the number of API calls, and the job's tuning settings. What is shown: the search text, the period and the
  filters (no replies, no retweets, minimum likes, language).
- "history" is now a reserved address, so a topic cannot be called `history`.

## AI analysis of a History job
**Analyze with AI** on a finished History job labels every tweet with a language model and writes a summary. It uses **OpenRouter** models
only, so it needs the `OPENROUTER_API_KEY` secret (`npx wrangler secret put OPENROUTER_API_KEY`); without it the panel says so. The
gpt-oss models are not offered here: on batch labelling they spend their whole token allowance "thinking" and answer nothing.
- **Themes and subjects are yours**: write the themes (what the tweets are about) and up to six *subjects* (named things people take sides
  on) as `Name: description` lines, or press **Suggest themes and subjects with AI**: the stronger model reads a sample of about 150
  tweets (the most liked plus a random handful) and proposes both; edit freely. Changing them later discards the labels (after a warning).
- **Models are tiered to keep the cost down.** A *cheap model* (default Mistral Small 3.2, $0.075 / $0.20 per million tokens) labels the
  tweets in batches of 40: theme, kind (news, opinion, announcement, question, promo, humor, spam, other) and the stance toward each
  subject (supportive, critical, neutral, not about it). Savings before any call: tweets too short to say anything are labelled "other"
  for free, and duplicate texts are labelled once and copied. The *stronger model* (default Claude Haiku 5.5) is used only for (1) tweets
  the cheap model could not label in a usable form after two tries, (2) tweets the cheap model flagged as unsure, best-liked first and
  up to the share you allow (0 to 30%), and (3) the proposal and the written summary, each one call. If the cheap model fails on more
  than 30% of the tweets the run stops with a message to pick another one, rather than paying the strong model to redo everything.
  Pick Claude Sonnet 5.5 as the stronger model for the best summaries at a few cents more per run.
- **Cost control**: **Estimate cost** (from the stored tweets) shows the expected spend before you run; the run stops at your budget
  (default $2, resumable) and labels at most N tweets (a stable sample beyond that, default 20,000). Spend is listed on the Costs tab
  as "History analysis (AI)", split into the cheap and the strong model. The model prices are the list prices in
  `src/summarize/openrouter.ts`. I could not test the OpenRouter models from the development machine (no key there), so the first real
  run is worth watching on a small job: the estimate and the actual spend are both shown.
- **Results** (in the panel, saved with the job): the summary (overview, storylines with cited tweets, timeline, where people
  disagree, caveats), tweets per theme, kinds, and the stance split per subject, also over time. Tick **Show the analysis on the public
  report page** and, once the report is published, the summary, themes and stance charts appear there, labelled as written by AI. Only
  links to posts on x.com survive in the summary.
- It keeps running on the server if you close the page (and carries on after a deploy). Resuming a collection marks the analysis out of
  date; run it again and only the new tweets are labelled. Deleting a job deletes its analysis.

## Pictures for briefings
Each briefing can have a picture, drawn by an image model from the briefing text and shown at the top of the public post
(and of each day under "Previous days"), labelled "AI-generated illustration", and used as the page's `og:image`. The pictures are stored in the
same R2 bucket as the audio (under `image/`). The models run on Replicate (the `REPLICATE_API_TOKEN` secret) or on Cloudflare Workers AI (the
`AI` binding in `wrangler.jsonc`, nothing to set up).

**Image templates** (`/admin` → Briefings → *Image templates*): shared by all topics, editable, restorable like the audio templates. A
template is an **image model**, a **shape** (16:9, 4:3 or 1:1) and a **prompt**. The models:
| Model | Where | Price per picture |
| --- | --- | --- |
| `google/nano-banana-pro` (2K) | Replicate | $0.15 |
| `google/imagen-4-fast` | Replicate | $0.02 |
| `black-forest-labs/flux-schnell` | Replicate | $0.003 |
| FLUX.2 klein 4B (`@cf/black-forest-labs/flux-2-klein-4b`) | Workers AI | free, about 90 a day; then flux-schnell |
| FLUX.2 klein 9B (`@cf/black-forest-labs/flux-2-klein-9b`) | Workers AI | free, about 6 a day; then imagen-4-fast |
| Leonardo Phoenix (`@cf/leonardo/phoenix-1.0`) | Workers AI | free, about 4 a day; then imagen-4-fast |

The Replicate prices are what Replicate shows for real runs (flux-schnell shows "less than $0.01"; its published price is $3 per 1,000
images). Change `IMAGE_MODELS` in `src/media/replicate.ts` if they change.

**The Workers AI models and their fallback.** Every account gets 10,000 Neurons a day free on Workers AI (reset at 00:00 UTC). The app keeps
its own tally of the Neurons its pictures use, from Cloudflare's published prices (`neuronsFor` in `src/media/workersai.ts`), and switches to
the model's Replicate fallback before a picture would take the day past 9,500 (the rest is room for other Workers AI use on the account,
which the app cannot see). It also falls back when Workers AI answers that the allowance is used up (error 4006: then it stops trying for the
rest of the day) or fails in any other way. The fallback is noted on the sample picture and in the Costs ledger. So these pictures cost
nothing, and at worst cost what the fallback costs. **Image templates** shows the Neurons used today.
- **Prompt**: combined with the briefing. `{title}`, `{date}`, `{tldr}` (the headline summary) and `{briefing}` (the first ~800
  characters of the text, plain) are filled in; a prompt that uses neither `{tldr}` nor `{briefing}` gets the briefing excerpt added
  after it, so the picture always follows the text. The starters ask for no text in the picture and no real people. The prompt that was
  used is kept on the issue and shown in the issue editor.
- Image models describe what to draw better than what to avoid: flux-schnell's safety filter once flagged an innocent "no faces" prompt as NSFW
  (a failed picture is retried up to three times). Prefer positive wording on the cheap model.
- **Make a sample picture** draws one picture with the unsaved edits (it costs a picture, or a picture's Neurons on Workers AI, and is listed
  in the Costs tab). If a Workers AI model fell back to Replicate, the sample says so above the picture.

**Per topic**: choose an image template and either tick "Create the picture automatically when a briefing is written" or make it by
hand: **Make picture for <newest briefing>** next to *Run now*, or **Make picture** / *Remake* / *Delete picture* on each issue. Like audio, a
picture is public only while its issue is published, and is flagged *out of date* if the text is edited afterwards. Locally,
`AUDIO_MOCK=1` makes placeholder pictures that cost nothing.

**Cost**: a flat price per picture, shown on the template, the topic form and the issue, and listed separately from text and audio
models on the Costs tab ("Image models"). Workers AI pictures are listed at $0, with the model that made each one.

## AI Gateway
[Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/) logs model calls with their model, tokens, cost and latency (dashboard:
AI → AI Gateway). The `AI_GATEWAY` variable in `wrangler.jsonc` names the gateway (`default`, which Cloudflare creates on first use).
- **OpenRouter calls** (writing, screening, History analysis, Signal topics, transcripts) go to the gateway's OpenRouter endpoint
  (`src/llm/gateway.ts`). The `default` gateway has authentication on, so the Worker needs a Cloudflare API token with the permission
  **AI Gateway → Run**: `npx wrangler secret put AI_GATEWAY_TOKEN --env=""`. The OpenRouter key is still sent with each call and passed on;
  it does not need to be stored on the gateway.
- **Workers AI pictures** pass the gateway id to the binding, which needs no token. FLUX.2 pictures are the exception: they are sent as
  multipart form data, which AI Gateway cannot pass on yet, so they go to Workers AI directly and are not in the gateway's log.
- **If the gateway refuses a call** (no token, or a token without the permission), that one call is sent straight to OpenRouter, and every
  later call from the same Worker instance goes direct too, with a warning in the logs. Nothing fails; the calls are just not logged.
- The gateway does not reduce the number of outgoing requests: a call through it counts like any other.
- To stop using it, remove `AI_GATEWAY` from `wrangler.jsonc`. Staging does not use it.

Worth setting while you are there: a **rate limit** on the gateway (a daily briefing run needs far less than 100 requests a minute), and a
**credit limit** on the OpenRouter key in OpenRouter's settings. Together they cap what a leaked token could spend.

## Costs
Everything that spends money reports to one ledger (`src/durable-objects/cost.ts`): explorer calls (Search, Users, Lists, Trends), History,
Monitor, the Summarize tab and scheduled briefings.
- **`/admin` → Costs**: totals, a per-day chart, spend by activity and by topic/watch/job, and the latest briefings and
  summaries, for 7, 30 or 90 days, plus your credits left.
- **`/admin` → Briefings**: each issue shows what it cost (X data and model, with tweets, calls and tokens). The topic form estimates the
  cost per run and per month while you edit (an upper bound for the X data, since it assumes every page is full) and, once the
  topic has run, shows the actual average next to it. A failed run still records what its data cost.
- **How it is counted**: X data at twitterapi.io's price per tweet/profile returned (at least one tweet per call); models at list
  price times tokens. Models without a known price count as zero. These are
  estimates; your real balance is the credits shown in the sidebar.
- **Data budget per run** (topic form, USD, 0 = none): a run stops fetching from X before it would exceed it, so a budget is
  never overshot, and the X lists in the topic share it equally (pages per list). A budget below one page per list leaves some
  lists unread (the form says how many); a run that is stopped early is marked on the issue and the public page says collection
  stopped early (never an amount). Only the X data is capped: the model's part is small and predictable.
- **Never public**: cost appears only under `/admin`. The public pages show where a briefing's tweets came from (the
  X lists, searches or curated lists used, how many posts and accounts, the time window and the model's name) but no amounts.
- Only on the deployed site; the local server does not keep a ledger.

## X Lists
Lists that live on x.com (for example [Scoble's index](https://x.com/scobleizer/lists)) are kept **by reference**: id, name,
groups and a note, never their members. In `/admin` → Lists → **X Lists**: "Import Scoble's lists" loads the 65 lists from his
shared document (`public/admin/x-lists-scoble.json`, grouped as in the document; a list can sit in several groups), and
"Add lists from links or ids" takes your own. Re-importing adds only what is new and keeps your renames.
- **Two ways to read a list**, chosen per view, per Summarize run and per scheduled source:
  - **Best posts** (the default): X searches the list (`list:<id>`) for the range's top posts, without retweets or replies and
    with at least N likes (default 5). 20 posts a call (about $0.003) and you pay only for what comes back, so it covers the
    whole range and costs a fraction. A 2-list group went from $0.044 to $0.012 a run, and from "the newest slice" to "the
    day's best".
  - **Newest first**: the list's timeline, about 80 tweets a call, retweets included. It has no time filter, so a busy list can
    take many calls to reach back a day (one list posts ~77 tweets every 36 minutes). Use it when you need everything, or for
    quiet lists. The likes threshold is a trade-off: it hides quiet but important posts, so lower it (3 to 5) for lists of small
    accounts.
- **A group can be viewed or summarized together** as one pool. Very busy lists are cut off at the depth you choose.
- **Public Lists page** (`/lists`, linked from the public sidebar and landing page): the X lists grouped by theme, each with its
  description and a link out to x.com. Each list has a **Public** switch in `/admin` → Lists → X Lists (plus "Show all publicly" /
  "Hide all" per group). Lists from Scoble's document start public (they are public lists on X); lists you add yourself start hidden
  unless you tick "Show on the public Lists page". Only the id, name, group and description are exposed. `lists` is a reserved address.
- **Summarize** has an "An X list" source (one list or a whole group, up to 20 lists), and scheduled topics (Briefings) have
  "X list" and "X list group" sources. A group is looked up when the job runs, so edits to it apply to the next run.
- Only on the deployed site; the local server (`npm start`) does not have this tab.

## Summarize tab and briefings (Strands agent on OpenRouter)
The Worker runs a Strands agent against **OpenRouter** (`SUMMARY_PROVIDER` is `"openrouter"` in `wrangler.jsonc`; the secret is
`OPENROUTER_API_KEY`). The default model is `anthropic/claude-haiku-5.5` (`SUMMARY_MODEL`); the Summarize tab and each topic have a
model picker (models, prices and notes live in `src/summarize/openrouter.ts`; the gpt-oss models are deliberately not listed).

**Workers AI** (the `AI` binding, there for the picture models) does not write briefings unless you set `SUMMARY_PROVIDER` to
`"workers-ai"`, but its models are offered in the Summarize model picker. The adapter is `src/summarize/workers-ai.ts`; the local Node server
uses it if `.env` has `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`.

Notes
- **The Workers Free plan is too small for large briefings.** One run happens in one Durable Object alarm, and the Free plan allows 50
  outgoing requests per invocation. A run makes one request per X list page, one screening call per tweet (screening starts at 25 tweets),
  and the writer's calls, so a topic over many X lists with 150 tweets needs about 200 and fails with "Too many subrequests". The error then
  lists the requests by host. The Workers Paid plan ($5 a month) allows 10,000. The Free plan's 10 ms CPU limit per request can also cut
  long agent requests short.
- Anthropic directly is also possible: `SUMMARY_PROVIDER=anthropic` and `wrangler secret put ANTHROPIC_API_KEY`.
- The agent code in `src/summarize/` runs unchanged under Node (type-stripped, so Node 22.18+) and in the Worker.
  `SUMMARY_MOCK=1` (dev only, never honoured behind Cloudflare's edge) swaps in a scripted model for tests.
- The OpenRouter models have not been run against real tweets yet. Check the output of the one you choose.
- The browser can only pick models from the built-in list; the ids in `wrangler.jsonc` are trusted. Locally, put `OPENROUTER_API_KEY` in `.env`.
- The AI analysis of History jobs and the model fallback logic are described in their own sections; the fallback to OpenRouter is no longer
  needed now that OpenRouter is the main provider (`SUMMARY_FALLBACK_MODEL` was removed).

## MCP server (read-only)
`https://tweets.example.com/mcp` is a read-only [Model Context Protocol](https://modelcontextprotocol.io) server for Claude, behind its own
Access application. The Claude app signs in with your Access login through **Managed OAuth**; Claude Code and scripts use a **service
token**. `get_signal` and `get_costs` open as interactive views (MCP Apps) in the Claude app. Setup, the tools and how the views work:
[mcp.md](mcp.md).

## Security model
- Every request, including static files, must carry a valid Cloudflare Access JWT (checked in the Worker).
- `workers_dev` and preview URLs are off; the Worker is only reachable on the custom domain.
- Writes need same-origin JSON, so other websites can't post to it with your Access cookie.
- The twitterapi.io key is a Worker secret; the browser never sees it.

## Retrying and re-running

Everything that runs on its own can be run again by hand, where you would look for it:

| What | When it failed | After you changed its settings |
| --- | --- | --- |
| A briefing | **Overview** shows the error with **Run again**; **Briefings** turns **Run now** into **Run again**. | **Briefing setup**: after **Save**, a bar offers **Run now** (a new issue) or **Re-run and replace** the latest. **Briefings** has **Re-run and replace** too. |
| A briefing's audio or picture | **Overview**: **Make again**. **Briefings**: the buttons on the issue. | The same buttons; they reuse the text, so nothing is fetched or written again. |
| A watch (Sources) | **Overview**: **Check again** for all failing ones; **Sources**: **Check now** on the card. | Applies at the next check; **Check now** runs it at once. |
| Signal topics by AI | **Overview** and **Signal setup → Topic detection**: **Retry** the items the model could not read, or a waiting error. | **Signal setup → Topic detection**: **Re-read** reads the last two weeks again with the current model (shows how many items and about what it costs). Saving a new model points you there. |
| An Archives collection | **Overview**: **Resume**. **Archives**: **Resume** on the job. | |

**Re-run and replace** writes the issue again from fresh posts with the current settings, at the same address, so links to it keep working.
A replaced issue that was published stays published. Its picture and audio are removed with it and can be made again.

Some changes need no re-run because they apply when reading: Signal weights, groups, filtered words, merged and renamed topics, and which
groups a Signal shows. They change Signal at once, also for what was counted before.

## YouTube through the API (when YouTube's feeds fail)

YouTube channels are watched through their public feeds (`youtube.com/feeds/videos.xml`), which cost nothing and need no key. YouTube sometimes
answers 404 for every channel feed for days. With a YouTube Data API key, a channel or playlist whose feed fails is read through the API instead,
with the same video ids, so nothing is counted twice when the feed comes back. Without a key, the failing channels show on **Overview**.

Getting a key (free):
1. Open the [Google Cloud console](https://console.cloud.google.com/) and sign in with a Google account.
2. Create a project (the project picker at the top, **New project**), or pick one you have.
3. **APIs & Services → Library**, search for **YouTube Data API v3**, open it and click **Enable**.
4. **APIs & Services → Credentials → Create credentials → API key**. Copy the key.
5. Restrict it (recommended): open the key, under **API restrictions** choose **Restrict key** and tick only **YouTube Data API v3**. Save.
6. Store it as a secret of the production Worker:
   ```
   npx wrangler secret put YOUTUBE_API_KEY --env=""
   ```
   (`--env=""` means the production Worker; without it Wrangler warns because a staging environment is defined too.)

Cost: none. Each check of a failing channel uses 1 unit of the free quota of 10,000 units a day; 20 channels checked every hour use about 480.
No billing account is needed for this quota.

## Visitor statistics (Cloudflare Web Analytics)

The public pages can count visits with Cloudflare Web Analytics: page views, referrers, countries and load times, without cookies and without
storing anything about a visitor. It is off until a token is set; without it the public pages load no script at all.

Getting the token:
1. In the [Cloudflare dashboard](https://dash.cloudflare.com/), open your **account** (not the domain).
2. Open **Analytics & Logs → Web Analytics** (on some dashboards it is directly under **Web Analytics**).
3. **Add a site** and enter the public domain, for example `tweets.example.com`.
4. If Cloudflare offers **automatic setup** (it does for domains that run through Cloudflare), choose the **manual / JS snippet** option instead.
   The site adds the script itself; both together would count every visit twice.
5. The snippet looks like
   `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "a1b2c3…"}'></script>`.
   The token is the value after `"token":`. For a site you added before, **Manage site** shows the snippet again.
6. Store it as a secret:
   ```
   npx wrangler secret put CF_ANALYTICS_TOKEN --env=""
   ```
7. Deploy. The statistics appear under **Web Analytics** in the dashboard after the first visits (allow a few minutes).

The page's security policy allows exactly this one script (`static.cloudflareinsights.com`) and only when the token is set. The admin pages never load it.

To check which secrets the production Worker has: `npx wrangler secret list --env=""`.

## Reader reports ("Report an error")

Every theme of a published briefing, and the briefing as a whole, has a **Report an error** link to a short form (a message, nothing else).
Reports appear on the admin **Overview** under "What readers reported", with a link to the briefing and the theme, and a **Done** button.
Nothing to set up. Limits against floods: a hidden field that only bots fill in, at most 5 reports per reader a day (counted with a hash of
the address and the day, the address itself is not stored), and at most 500 unread reports.

## Local testing of the Worker
`npm run dev` (uses `.dev.vars`, which bypasses Access locally only; the bypass is ignored whenever a
`CF-Ray` header is present, i.e. always in production).

## Decision models (Perplexity Decider)

`~perplexity/pplx-decider-flash-latest` and `~perplexity/pplx-decider-latest` on OpenRouter do not write text: they answer typed questions
about a piece of content (`src/llm/decisions.ts`, endpoint `/api/v1/systemone`, about $0.01 to $0.02 per million input tokens). They use the same
`OPENROUTER_API_KEY`. Two uses:

- **History analysis**: pick one as the *cheap model*. Each tweet is one request (theme, kind and stance as choice questions). It cannot be the
  stronger model, which writes text. A run stops after 3000 requests per alarm slice and carries on in the next.
- **Screening summaries and briefings** (`src/summarize/screen.ts`): before the writing model sees the tweets, a decider drops off-topic and
  spam tweets and gives each of the rest a `signal` (0 to 100) that the writer uses to choose notable posts. On by default when OpenRouter is
  available; set `SUMMARY_SCREEN_MODEL` to `off`, or to the non-Flash id for the more accurate model. It only runs with 25 or more tweets, keeps at
  least 20, and never fails a summary: if it cannot run, the tweets go on unscreened.
