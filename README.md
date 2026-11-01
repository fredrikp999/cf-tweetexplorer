# Tweet Explorer

[![CI](https://github.com/fredrikp999/cf-tweetexplorer/actions/workflows/ci.yml/badge.svg)](https://github.com/fredrikp999/cf-tweetexplorer/actions/workflows/ci.yml)

Explore X (Twitter) data, collect it at scale, and have language models turn it into something readable.
It runs as a single [Cloudflare Worker](https://developers.cloudflare.com/workers/) with a private admin app and a small public site.

## Features

- **Explore**: Search, User, Trends, your own Lists, X Lists, and Monitor (polling watches).
- **History**: collect every tweet for a search over a long period; read the statistics; run an **AI analysis**
  (themes, kinds, stance toward subjects, a written summary); publish it as a report.
- **Summarize**: an agent that reads tweets and writes a cited summary on demand.
- **Briefings**: topics summarized on a schedule, reviewed as drafts, and published at `/<address>`, with an optional audio version and picture.
- **Costs**: one ledger of everything that spends money.

Tweet data comes from [twitterapi.io](https://twitterapi.io), language models from [OpenRouter](https://openrouter.ai), and audio and pictures from
[Replicate](https://replicate.com).

## Quick start

You need Node.js 22.18 or newer and a [twitterapi.io](https://twitterapi.io) key.

**Run it locally**

```sh
npm install
cp .env.example .env          # add TWITTERAPI_IO_KEY (and OPENROUTER_API_KEY for summaries)
npm start                     # http://localhost:3000
```

**Run the Worker locally** (the code that is deployed)

```sh
npm run types                 # generates worker-configuration.d.ts from wrangler.jsonc
cp .dev.vars.example .dev.vars
npm run dev
```

**Deploy to Cloudflare**: see [docs/deployment.md](docs/deployment.md). In short:

```sh
npx wrangler login
npx wrangler secret put TWITTERAPI_IO_KEY --env=""
npx wrangler secret put OPENROUTER_API_KEY --env=""
DEPLOY_DOMAIN=tweets.example.com npm run release     # check, deploy, smoke test
```

Then protect `/admin*` with a Cloudflare Access application and store its team domain and audience tag as the secrets `TEAM_DOMAIN` and `POLICY_AUD`.
Until that is done every request is refused. Nothing about your account or domain is kept in the repository.

## Documentation

| | |
| --- | --- |
| [Architecture](docs/architecture.md) | How it is deployed, the Durable Objects, the code map, which models are used |
| [Flows](docs/flows.md) | What happens for History, AI analysis, Summarize, briefings and screening, step by step |
| [Configuration](docs/configuration.md) | Secrets, variables, and every option in the app |
| [Deployment](docs/deployment.md) | How to deploy (release, smoke test, staging), retrying and re-running, and setup one feature at a time: Access, briefings, audio, pictures, YouTube API, analytics |

## Project layout

```
src/        The Cloudflare Worker and its Durable Objects
server/     The same app for local use with Node
public/     The admin app (a single HTML page, no build step)
test/       Tests
docs/       Documentation
```

## Development

```sh
npm run typecheck             # TypeScript
npm test                      # node --test, no extra dependencies
npm run check                 # both
npm run build                 # bundle the Worker without deploying
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Licensed under the [MIT License](LICENSE).
