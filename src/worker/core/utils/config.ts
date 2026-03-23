/** Type-safe access to environment bindings and secrets. */
export function getConfig(env: Env) {
  return {
    environment: env.ENVIRONMENT ?? "development",
    isDev: (env.ENVIRONMENT ?? "development") === "development",

    polymarket: {
      apiKey: env.POLYMARKET_API_KEY,
      privateKey: env.POLYMARKET_PRIVATE_KEY,
    },

    kalshi: {
      apiKey: env.KALSHI_API_KEY,
      apiSecret: env.KALSHI_API_SECRET ?? env.KALSHI_PRIVATE_KEY,
      environment: env.KALSHI_ENVIRONMENT,
    },

    authToken: env.AUTH_TOKEN,
  } as const;
}

export type AppConfig = ReturnType<typeof getConfig>;
