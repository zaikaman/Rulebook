/**
 * Two-sided limiter: a per-address minute window stops a retry loop, and a global daily cap
 * bounds what a farm of fresh addresses can spend from the sponsor. In-process only; a
 * restart resets it, which is acceptable because the on-chain factory refuses duplicates.
 */
export class OnboardingRateLimiter {
  private readonly hits = new Map<string, number[]>();
  private dayKey = '';
  private dailyCount = 0;

  constructor(
    private readonly perMinute: number,
    private readonly dailyCap: number,
    private readonly now: () => number = Date.now,
  ) {}

  allow(key: string): boolean {
    const current = this.now();
    const day = new Date(current).toISOString().slice(0, 10);
    if (day !== this.dayKey) {
      this.dayKey = day;
      this.dailyCount = 0;
    }
    if (this.dailyCount >= this.dailyCap) return false;

    const recent = (this.hits.get(key) ?? []).filter((timestamp) => current - timestamp < 60_000);
    if (recent.length >= this.perMinute) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(current);
    this.hits.set(key, recent);
    this.dailyCount += 1;
    return true;
  }
}
