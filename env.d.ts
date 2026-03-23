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
  /** RSA private key PEM (alias of KALSHI_PRIVATE_KEY) */
  KALSHI_API_SECRET?: string;
  /** RSA private key PEM — preferred name in some setups */
  KALSHI_PRIVATE_KEY?: string;
  /** "demo" | "prod" — selects Kalshi demo vs production Trade API host */
  KALSHI_ENVIRONMENT?: string;
  AUTH_TOKEN?: string;
  DISCORD_WEBHOOK_URL?: string;
  AI?: Ai;
}
