import { BaseBotDO } from "./base";
import { getStrategy } from "./registry";
import { Logger } from "../core/utils/logger";

/**
 * Concrete BotDO — single Durable Object class for all bot types.
 * Loads strategy by `botType` from the registry.
 */
export class BotDO extends BaseBotDO {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.log = new Logger({ do: "BotDO", id: ctx.id.toString() });

    // Hydrate on construction (runs async, alarm waits for it)
    ctx.blockConcurrencyWhile(() => this.hydrate());
  }

  protected async tick(): Promise<void> {
    if (!this.config) throw new Error("No config — bot not started");

    const strategy = getStrategy(this.config.botType);
    if (!strategy) {
      this.log.warn("tick:no-strategy", { botType: this.config.botType });
      // For now, just log — Phase 3 will add real strategies
      this.log.info("tick:noop", {
        botType: this.config.botType,
        tick: this.tickCount,
      });
      return;
    }

    await strategy(this, this.env);
  }
}
