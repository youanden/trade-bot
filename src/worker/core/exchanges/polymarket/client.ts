import {
  createWalletClient,
  http,
  type WalletClient,
  type Hex,
  parseUnits,
  formatUnits,
} from "viem";
import { polygon } from "viem/chains";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type {
  ExchangeClient,
  MarketInfo,
  OrderRequest,
  OrderResult,
  OrderBook,
  PositionInfo,
} from "../types";
import {
  type PolymarketConfig,
  type GammaMarket,
  type ClobMarket,
  type ClobOrderBook,
  type ClobOrderResponse,
  type ClobOpenOrder,
  POLY_CONTRACTS,
  POLY_URLS,
  ORDER_EIP712_TYPES,
  CLOB_AUTH_DOMAIN,
  CLOB_AUTH_TYPES,
} from "./types";
import { buildHmacSignature } from "./hmac";
import { ClobApiError } from "./errors";
import { Logger } from "../../utils/logger";

const USDC_DECIMALS = 6;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export class PolymarketClient implements ExchangeClient {
  readonly platform = "polymarket" as const;
  private config: PolymarketConfig;
  private account: PrivateKeyAccount;
  private log: Logger;

  constructor(config: PolymarketConfig) {
    this.config = {
      chainId: 137,
      signatureType: 0,
      ...config,
    };
    this.account = privateKeyToAccount(config.privateKey as Hex);
    this.log = new Logger({ exchange: "polymarket" });
  }

  // ── Market Discovery (via Gamma API) ──

  async getMarkets(params?: {
    limit?: number;
    cursor?: string;
    status?: string;
  }): Promise<{ markets: MarketInfo[]; nextCursor?: string }> {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set("limit", String(params.limit));
    if (params?.cursor) searchParams.set("offset", params.cursor);
    searchParams.set("closed", params?.status === "closed" ? "true" : "false");

    const res = await fetch(
      `${POLY_URLS.GAMMA}/markets?${searchParams.toString()}`
    );
    if (!res.ok) throw new Error(`Gamma API ${res.status}: ${await res.text()}`);

    const data: GammaMarket[] = await res.json();
    const markets = data.map((m) => this.gammaToMarketInfo(m));

    return {
      markets,
      nextCursor:
        data.length === (params?.limit ?? 100)
          ? String(Number(params?.cursor ?? "0") + data.length)
          : undefined,
    };
  }

  async getMarket(conditionId: string): Promise<MarketInfo> {
    const res = await this.clobFetch(`/markets/${conditionId}`);
    const data: ClobMarket = await res.json();
    return this.clobToMarketInfo(data);
  }

  // ── Pricing ──

  async getPrice(
    tokenId: string
  ): Promise<{ yes: number; no: number }> {
    const res = await this.clobFetch(
      `/midpoint?token_id=${tokenId}`
    );
    const data = await res.json() as any;
    const mid = Number(data.mid);
    return { yes: mid, no: 1 - mid };
  }

  async getOrderBook(tokenId: string): Promise<OrderBook> {
    const res = await this.clobFetch(`/book?token_id=${tokenId}`);
    const data: ClobOrderBook = await res.json();
    return {
      bids: data.bids.map((l) => ({
        price: Number(l.price),
        size: Number(l.size),
      })),
      asks: data.asks.map((l) => ({
        price: Number(l.price),
        size: Number(l.size),
      })),
      timestamp: data.timestamp,
    };
  }

  // ── Trading ──

  async placeOrder(order: OrderRequest): Promise<OrderResult> {
    const tokenId = order.marketId; // expects the token ID
    const side = order.side === "buy" ? "BUY" : "SELL";

    // Calculate amounts in USDC (6 decimals)
    const priceStr = order.price.toFixed(USDC_DECIMALS);
    const sizeStr = order.size.toFixed(USDC_DECIMALS);
    const totalStr = (order.price * order.size).toFixed(USDC_DECIMALS);

    let makerAmount: bigint;
    let takerAmount: bigint;

    if (side === "BUY") {
      makerAmount = parseUnits(totalStr, USDC_DECIMALS); // USDC spent
      takerAmount = parseUnits(sizeStr, USDC_DECIMALS); // tokens received
    } else {
      makerAmount = parseUnits(sizeStr, USDC_DECIMALS); // tokens spent
      takerAmount = parseUnits(totalStr, USDC_DECIMALS); // USDC received
    }

    const salt = BigInt(Math.floor(Math.random() * 2 ** 128));
    const sigType = this.config.signatureType ?? 0;
    const maker = this.config.funderAddress ?? this.config.address;

    // Determine exchange contract (negRisk or standard)
    const exchangeAddress = POLY_CONTRACTS.CTF_EXCHANGE; // TODO: detect negRisk per market

    const orderData = {
      salt,
      maker: maker as `0x${string}`,
      signer: this.config.address as `0x${string}`,
      taker: ZERO_ADDRESS as `0x${string}`,
      tokenId: BigInt(tokenId),
      makerAmount,
      takerAmount,
      expiration: 0n,
      nonce: 0n,
      feeRateBps: 0n,
      side: side === "BUY" ? 0 : 1,
      signatureType: sigType,
    };

    // Sign with EIP-712
    const signature = await this.account.signTypedData({
      domain: {
        name: "Polymarket CTF Exchange",
        version: "1",
        chainId: this.config.chainId!,
        verifyingContract: exchangeAddress,
      },
      types: ORDER_EIP712_TYPES,
      primaryType: "Order",
      message: orderData,
    });

    const body = {
      order: {
        salt: salt.toString(),
        maker,
        signer: this.config.address,
        taker: ZERO_ADDRESS,
        tokenId,
        makerAmount: makerAmount.toString(),
        takerAmount: takerAmount.toString(),
        expiration: "0",
        nonce: "0",
        feeRateBps: "0",
        side,
        signatureType: sigType,
        signature,
      },
      owner: maker,
      orderType: order.timeInForce === "fok" ? "FOK" : "GTC",
      ...(order.postOnly ? { postOnly: true } : {}),
    };

    const res = await this.clobFetch("/order", {
      method: "POST",
      body: JSON.stringify(body),
      auth: true,
    });

    const result: ClobOrderResponse = await res.json();

    if (!result.success) {
      this.log.error("order:failed", { error: result.errorMsg });
      return {
        orderId: result.orderID ?? "",
        status: "failed",
      };
    }

    return {
      orderId: result.orderID,
      status:
        result.status === "matched"
          ? "filled"
          : result.status === "live"
            ? "open"
            : "open",
      filledSize: result.takingAmount
        ? Number(formatUnits(BigInt(result.takingAmount), USDC_DECIMALS))
        : undefined,
    };
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.clobFetch("/order", {
      method: "DELETE",
      body: JSON.stringify({ id: orderId }),
      auth: true,
    });
  }

  async getOrder(orderId: string): Promise<OrderResult> {
    const res = await this.clobFetch(`/data/order/${orderId}`, { auth: true });
    const data: ClobOpenOrder = await res.json();
    return {
      orderId: data.id,
      status: this.mapOrderStatus(data.status),
      filledSize: Number(data.size_matched),
      remainingSize:
        Number(data.original_size) - Number(data.size_matched),
    };
  }

  async getOpenOrders(marketId?: string): Promise<OrderResult[]> {
    const params = marketId ? `?market=${marketId}` : "";
    const res = await this.clobFetch(`/data/orders${params}`, { auth: true });
    const data: ClobOpenOrder[] = await res.json();
    return data.map((o) => ({
      orderId: o.id,
      status: this.mapOrderStatus(o.status),
      filledSize: Number(o.size_matched),
      remainingSize: Number(o.original_size) - Number(o.size_matched),
    }));
  }

  // ── Portfolio ──

  async getPositions(): Promise<PositionInfo[]> {
    const res = await fetch(
      `${POLY_URLS.DATA}/positions?user=${this.config.address}`
    );
    if (!res.ok) throw new Error(`Data API ${res.status}`);
    const data = await res.json();

    return (data as any[]).map((p: any) => ({
      marketId: p.asset?.condition_id ?? p.conditionId ?? "",
      outcome: (p.outcome ?? "yes").toLowerCase() as "yes" | "no",
      size: Number(p.size ?? 0),
      avgEntry: Number(p.avgPrice ?? 0),
      currentPrice: Number(p.currentPrice ?? 0),
    }));
  }

  async getBalance(): Promise<number> {
    const res = await this.clobFetch("/balance-allowance", { auth: true });
    const data = await res.json();
    return Number(
      formatUnits(BigInt((data as any).balance ?? "0"), USDC_DECIMALS)
    );
  }

  // ── Auth helpers ──

  /** Derive API credentials from wallet (one-time operation). */
  async deriveApiCredentials(): Promise<{
    apiKey: string;
    secret: string;
    passphrase: string;
  }> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = 0n;

    const signature = await this.account.signTypedData({
      domain: CLOB_AUTH_DOMAIN,
      types: CLOB_AUTH_TYPES,
      primaryType: "ClobAuth",
      message: {
        address: this.config.address as `0x${string}`,
        timestamp,
        nonce,
        message:
          "This message attests that I control the given wallet",
      },
    });

    const res = await fetch(`${POLY_URLS.CLOB}/auth/derive-api-key`, {
      method: "GET",
      headers: {
        POLY_ADDRESS: this.config.address,
        POLY_SIGNATURE: signature,
        POLY_TIMESTAMP: timestamp,
        POLY_NONCE: "0",
      },
    });

    if (!res.ok)
      throw new Error(`Auth derive failed: ${res.status} ${await res.text()}`);
    return res.json();
  }

  // ── Internal helpers ──

  private async clobFetch(
    path: string,
    opts?: { method?: string; body?: string; auth?: boolean }
  ): Promise<Response> {
    const method = opts?.method ?? "GET";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (opts?.auth) {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const sigB64 = await buildHmacSignature({
        secret: this.config.apiSecret,
        timestamp,
        method,
        path,
        body: opts.body ?? "",
      });

      headers["POLY_ADDRESS"] = this.config.address;
      headers["POLY_SIGNATURE"] = sigB64;
      headers["POLY_TIMESTAMP"] = timestamp;
      headers["POLY_API_KEY"] = this.config.apiKey;
      headers["POLY_PASSPHRASE"] = this.config.passphrase;
    }

    const res = await fetch(`${POLY_URLS.CLOB}${path}`, {
      method,
      headers,
      body: opts?.body,
    });

    if (!res.ok) {
      let body = "";
      try { body = await res.text(); } catch {}
      throw new ClobApiError(res.status, `CLOB ${method} ${path}`, body);
    }

    return res;
  }

  private gammaToMarketInfo(m: GammaMarket): MarketInfo {
    const prices = m.outcomePrices?.map(Number) ?? [];
    return {
      platformId: m.conditionId,
      platform: "polymarket",
      title: m.question,
      description: m.description,
      endDate: m.endDate,
      status: m.closed ? "closed" : m.active ? "active" : "resolved",
      yesPrice: prices[0],
      noPrice: prices[1],
      volume: m.volume ? Number(m.volume) : undefined,
      meta: {
        clobTokenIds: m.clobTokenIds,
        negRisk: m.negRisk,
        slug: m.slug,
      },
    };
  }

  private clobToMarketInfo(m: ClobMarket): MarketInfo {
    const yesToken = m.tokens?.find((t) => t.outcome === "Yes");
    const noToken = m.tokens?.find((t) => t.outcome === "No");
    return {
      platformId: m.condition_id,
      platform: "polymarket",
      title: m.question,
      description: m.description,
      category: m.category,
      endDate: m.end_date_iso,
      status: m.closed ? "closed" : m.active ? "active" : "resolved",
      yesPrice: yesToken?.price,
      noPrice: noToken?.price,
      meta: {
        tokens: m.tokens,
        negRisk: m.neg_risk,
        minOrderSize: m.minimum_order_size,
        tickSize: m.minimum_tick_size,
      },
    };
  }

  private mapOrderStatus(
    s: string
  ): "open" | "filled" | "partial" | "failed" | "cancelled" {
    switch (s) {
      case "live":
      case "open":
        return "open";
      case "matched":
      case "filled":
        return "filled";
      case "cancelled":
        return "cancelled";
      default:
        return "open";
    }
  }
}
