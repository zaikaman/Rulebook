import { parseEther } from 'viem';
import { CHAIN_CONFIGS, isAutomationChain } from './chains.js';

export type FeeCreditKind = 'watching' | 'execution';

/** Typical gas per Reactive trigger evaluation (`WorkflowAgentV2.react`). */
export const WATCHING_ESTIMATED_GAS_PER_RUN = 200_000n;

/** Typical gas per settlement callback on Unichain / Base (below the 850,000 callback cap). */
export const EXECUTION_ESTIMATED_GAS_PER_RUN = 350_000n;

/** Upper bound for displayed run-count estimates to avoid exaggerated projections at very low gas. */
export const MAX_DISPLAYED_RUNWAY_RUNS = 1000;

export interface CreditRunwayEstimate {
  readonly netReserveWei: bigint;
  readonly estimatedCostPerRunWei: bigint;
  readonly rawRuns: bigint;
  readonly runs: number;
  readonly capped: boolean;
  readonly underOneRun: boolean;
  readonly depleted: boolean;
}

/** Credit below this amount is considered low for the corresponding network. */
export function feeCreditWarningThreshold(chainId: number): bigint {
  const mainnet = CHAIN_CONFIGS.get(chainId)?.network === 'mainnet';
  if (isAutomationChain(chainId)) {
    return parseEther(mainnet ? '0.5' : '0.05');
  }
  return parseEther(mainnet ? '0.001' : '0.0001');
}

/** Estimated gas units consumed by one typical evaluation or settlement run. */
export function estimatedGasPerRun(kind: FeeCreditKind): bigint {
  return kind === 'watching' ? WATCHING_ESTIMATED_GAS_PER_RUN : EXECUTION_ESTIMATED_GAS_PER_RUN;
}

/** Short human-readable label describing the gas assumption for a credit lane. */
export function estimatedGasPerRunLabel(kind: FeeCreditKind): string {
  return kind === 'watching' ? '~200k gas per trigger check' : '~350k gas per settlement callback';
}

/** Estimated native wei consumed by one typical run at `gasPriceWei`. */
export function estimateRunCostWei(
  kind: FeeCreditKind,
  gasPriceWei: bigint,
  extraGas: bigint,
  gasPriceCoeffPer1000: bigint,
): bigint | null {
  if (gasPriceWei <= 0n || gasPriceCoeffPer1000 <= 0n) return null;
  return (gasPriceWei * gasPriceCoeffPer1000 * (estimatedGasPerRun(kind) + extraGas)) / 1000n;
}

/** Translates reserve, outstanding debt, and live gas price into an approximate run-count estimate. */
export function estimateCreditRunway({
  reserveWei,
  debtWei = 0n,
  estimatedCostPerRunWei,
}: {
  readonly reserveWei: bigint;
  readonly debtWei?: bigint;
  readonly estimatedCostPerRunWei: bigint;
}): CreditRunwayEstimate | null {
  if (estimatedCostPerRunWei <= 0n) return null;
  const reserve = reserveWei > 0n ? reserveWei : 0n;
  const debt = debtWei > 0n ? debtWei : 0n;
  const netReserveWei = reserve > debt ? reserve - debt : 0n;
  const rawRuns = netReserveWei / estimatedCostPerRunWei;
  const capped = rawRuns > BigInt(MAX_DISPLAYED_RUNWAY_RUNS);
  const runs = capped ? MAX_DISPLAYED_RUNWAY_RUNS : Number(rawRuns);
  const depleted = netReserveWei === 0n;
  const underOneRun = !depleted && rawRuns === 0n;
  return {
    netReserveWei,
    estimatedCostPerRunWei,
    rawRuns,
    runs,
    capped,
    underOneRun,
    depleted,
  };
}

/** Formats a runway estimate as `~N runs covered` (or `~N runs` when `suffix: 'none'`). */
export function formatRunwayRuns(
  estimate: CreditRunwayEstimate,
  options?: { readonly suffix?: 'covered' | 'none' },
): string {
  const tail = options?.suffix === 'none' ? '' : ' covered';
  if (estimate.depleted) return `0 runs${tail}`;
  if (estimate.underOneRun) return `< 1 run${tail}`;
  if (estimate.capped) return `${MAX_DISPLAYED_RUNWAY_RUNS.toLocaleString('en-US')}+ runs${tail}`;
  if (estimate.runs === 1) return `~1 run${tail}`;
  return `~${estimate.runs.toLocaleString('en-US')} runs${tail}`;
}
