# Contributing

## Setup

```sh
npm install
npm run types        # generates worker-configuration.d.ts (git-ignored) from wrangler.jsonc
npm run check        # type check and tests
```

Node.js 22.18 or newer is needed: the tests and the local server import the TypeScript sources directly, using Node's type stripping, so
there is no build step. That also means source files avoid TypeScript-only runtime syntax (enums, constructor parameter properties).

## Working on it

- **Without spending anything**: put `SUMMARY_MOCK=1` and `AUDIO_MOCK=1` in `.dev.vars` (see `.dev.vars.example`); models and text to speech then return
  scripted answers. `DEV_BYPASS_ACCESS=1` skips the Cloudflare Access check locally, and is ignored for requests that came through Cloudflare's edge.
- **Where things are**: [docs/architecture.md](docs/architecture.md) has the code map and [docs/flows.md](docs/flows.md) the step-by-step flows.
- **Tests** live in `test/` and run with `npm test`. Model and network calls are faked (`test/helpers/`), so tests need no keys. Put logic that
  can be tested without Worker APIs in plain modules (like `src/history/analysis.ts`); the Durable Objects import `cloudflare:workers` and cannot run in Node.
- **Style**: follow the surrounding code (comment density, naming, idiom). `.editorconfig` has the whitespace rules.

## Pull requests

1. Keep a change focused, and say why in the description.
2. `npm run check` and `npm run build` must pass; CI runs both.
3. If you change a setting, a route or a flow, update the matching page in `docs/`.
4. Never commit secrets (`.env`, `.dev.vars`) or the `.data/` folder.
