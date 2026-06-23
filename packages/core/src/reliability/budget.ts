export class BudgetExceeded extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceeded";
  }
}

/** Rough token estimate (~4 chars/token) — good enough for a cap, no tokenizer dependency. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

/** Cost meter + hard cap. charge() throws BudgetExceeded once the cap is crossed. */
export class Budget {
  private usd = 0;
  constructor(
    private readonly capUsd: number,
    private readonly usdPerKTokIn = 0.0005,
    private readonly usdPerKTokOut = 0.0015,
  ) {}

  charge(inTokens: number, outTokens: number): void {
    this.usd += (inTokens / 1000) * this.usdPerKTokIn + (outTokens / 1000) * this.usdPerKTokOut;
    if (this.usd > this.capUsd) {
      throw new BudgetExceeded(`budget cap $${this.capUsd.toFixed(4)} exceeded ($${this.usd.toFixed(4)} spent)`);
    }
  }

  spentUsd(): number {
    return this.usd;
  }
}
