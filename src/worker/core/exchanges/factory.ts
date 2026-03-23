/**
 * Exchange client factory — creates the right client from env + platform string.
 */

import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { Hex } from "viem";
import type { ExchangeClient } from "./types";
import { PolymarketClient } from "./polymarket/client";
import { KalshiClient } from "./kalshi/client";
import type { KalshiConfig } from "./kalshi/types";
import type { PriceFeed } from "../simulation/feed";
import type { SimClientConfig } from "../simulation/sim-client";
import { SimExchangeClient } from "../simulation/sim-client";

/**
 * Create an exchange client for the given platform using env credentials.
 * Throws if required credentials are missing.
 *
 * @param env - Worker environment bindings (credentials, etc.)
 * @param platform - Target trading platform
 * @param simFeed - Optional simulation feed; when provided, returns a
 *   SimExchangeClient instead of a real exchange client. Existing callers
 *   with no third argument are unaffected.
 */
export function createExchangeClient(
  env: Env,
  platform: "polymarket" | "kalshi",
  simFeed?: { feed: PriceFeed; config?: Partial<Omit<SimClientConfig, "platform" | "feed">> }
): ExchangeClient {
  if (simFeed) {
    return new SimExchangeClient({
      platform,
      feed: simFeed.feed,
      simulatedNow: simFeed.config?.simulatedNow ?? (() => new Date().toISOString()),
      virtualBalance: simFeed.config?.virtualBalance ?? 1000,
      ...simFeed.config,
    });
  }
  if (platform === "polymarket") {
    return createPolymarketClient(env);
  }
  if (platform === "kalshi") {
    return createKalshiClient(env);
  }
  throw new Error(`Unknown platform: ${platform}`);
}

function createPolymarketClient(env: Env): PolymarketClient {
  if (!env.POLYMARKET_PRIVATE_KEY) {
    throw new Error("Missing POLYMARKET_PRIVATE_KEY");
  }
  if (!env.POLYMARKET_API_KEY) {
    throw new Error("Missing POLYMARKET_API_KEY");
  }

  const account: PrivateKeyAccount = privateKeyToAccount(
    env.POLYMARKET_PRIVATE_KEY as Hex
  );

  return new PolymarketClient({
    privateKey: env.POLYMARKET_PRIVATE_KEY,
    apiKey: env.POLYMARKET_API_KEY,
    apiSecret: env.POLYMARKET_API_SECRET ?? "",
    passphrase: env.POLYMARKET_PASSPHRASE ?? "",
    address: env.POLYMARKET_ADDRESS ?? account.address,
  });
}

/**
 * Resolves Kalshi RSA PEM from env (secret name varies by deployment).
 */
export function resolveKalshiPrivateKeyPem(env: Env): string {
  const pem = env.KALSHI_API_SECRET ?? env.KALSHI_PRIVATE_KEY;
  if (!pem) {
    throw new Error("Missing KALSHI_API_SECRET or KALSHI_PRIVATE_KEY");
  }
  return pem;
}

/**
 * Kalshi Trade API environment (demo vs production hosts).
 */
export function resolveKalshiEnvironment(env: Env): "demo" | "prod" {
  const v = env.KALSHI_ENVIRONMENT?.toLowerCase();
  if (v === "demo") return "demo";
  return "prod";
}

function createKalshiClient(env: Env): KalshiClient {
  if (!env.KALSHI_API_KEY) {
    throw new Error("Missing KALSHI_API_KEY");
  }

  const config: KalshiConfig = {
    apiKeyId: env.KALSHI_API_KEY,
    privateKeyPem: resolveKalshiPrivateKeyPem(env),
    environment: resolveKalshiEnvironment(env),
  };

  return new KalshiClient(config);
}
