// Secrets and local-only settings. They are not in wrangler.jsonc, so `wrangler types` only learns of them from a local .dev.vars;
// declaring them here keeps type checking the same on every machine (CI has no .dev.vars). The types must match what `wrangler types` writes.
interface Env {
  /** From the Cloudflare Access application: `<team>.cloudflareaccess.com` and the application's audience tag. Secrets. */
  TEAM_DOMAIN: string;
  POLICY_AUD: string;
  /** The audience tag of the separate Access application for /mcp (service tokens only). Secret. */
  MCP_POLICY_AUD: string;
  TWITTERAPI_IO_KEY: string;
  ANTHROPIC_API_KEY: string;
  /** Local only (.dev.vars): skip the Access check / use scripted model answers. */
  DEV_BYPASS_ACCESS: string;
  SUMMARY_MOCK: string;
  SUMMARY_FALLBACK_MODEL: string;
  /** YouTube Data API key: read channels through the API when their public feed fails. Optional secret. */
  YOUTUBE_API_KEY: string;
  /** Cloudflare Web Analytics token for the public pages (no cookies). Optional secret. */
  CF_ANALYTICS_TOKEN: string;
}
