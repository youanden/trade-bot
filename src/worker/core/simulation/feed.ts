import type { GeneratedScenario } from "./types";

/** Wraps a GeneratedScenario price array and enforces no-lookahead access. */
export class PriceFeed {
  private readonly rows: GeneratedScenario["prices"];

  constructor(scenario: GeneratedScenario) {
    this.rows = scenario.prices;
  }

  /**
   * Returns all price rows with timestamp <= simulatedNow.
   * No-lookahead enforced: rows after the simulated clock are never visible.
   *
   * @param simulatedNow - ISO-8601 timestamp of the current simulated time
   */
  getUpTo(simulatedNow: string): GeneratedScenario["prices"] {
    return this.rows.filter((row) => row.timestamp <= simulatedNow);
  }

  /**
   * Returns the most recent visible price row at simulatedNow,
   * or undefined if no rows are visible yet.
   *
   * @param simulatedNow - ISO-8601 timestamp of the current simulated time
   */
  latestAt(
    simulatedNow: string,
  ): GeneratedScenario["prices"][number] | undefined {
    const visible = this.getUpTo(simulatedNow);
    return visible.length > 0 ? visible[visible.length - 1] : undefined;
  }
}
