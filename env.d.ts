interface Env {
  DB: D1Database;
  BOT_DO: DurableObjectNamespace;
  ASSETS: Fetcher;
  ENVIRONMENT: string;
  POLYMARKET_API_KEY?: string;
  POLYMARKET_PRIVATE_KEY?: string;
  POLYMARKET_API_SECRET?: string;
  POLYMARKET_PASSPHRASE?: string;
  POLYMARKET_ADDRESS?: string;
  KALSHI_API_KEY?: string;
  KALSHI_API_SECRET?: string;
  AUTH_TOKEN?: string;
  DISCORD_WEBHOOK_URL?: string;
  AI?: Ai;
}
