import { isAutomationChain, isFundsChain, type SupportedChainId } from '@rulebook/shared';
import { queryOptions } from '@tanstack/react-query';
import { zeroHash, type Hex } from 'viem';

import { workflowClient } from './chainV2.js';

export interface StageReceiptTelemetry {
  readonly executionGas: bigint | null;
  readonly blockNumber: bigint | null;
  readonly timestamp: number | null;
}

export async function readProofStageTelemetry(
  chain: number,
  hash: Hex,
): Promise<StageReceiptTelemetry> {
  const client = workflowClient(chain as SupportedChainId);
  const receipt = await client.getTransactionReceipt({ hash });
  // Some Lasna receipts omit the effective price even when gas usage is recorded.
  const executionGas =
    typeof receipt.gasUsed === 'bigint' && typeof receipt.effectiveGasPrice === 'bigint'
      ? receipt.gasUsed * receipt.effectiveGasPrice
      : null;
  const blockNumber = typeof receipt.blockNumber === 'bigint' ? receipt.blockNumber : null;
  let timestamp: number | null = null;
  if (blockNumber !== null) {
    try {
      const block = await client.getBlock({ blockNumber });
      if (typeof block?.timestamp === 'bigint') {
        timestamp = Number(block.timestamp);
      }
    } catch {
      // Non-fatal: keep receipt gas even when block header lookup fails.
    }
  }
  return { executionGas, blockNumber, timestamp };
}

export function proofStageTelemetryQuery(chain: number, hash: Hex | null | undefined) {
  const validHash = Boolean(hash && hash !== zeroHash);
  const supported = isAutomationChain(chain) || isFundsChain(chain);
  return queryOptions({
    queryKey: ['workflow-v2', 'proof-stage-telemetry', chain, hash ?? null],
    enabled: validHash && supported,
    queryFn: () => readProofStageTelemetry(chain, hash!),
    staleTime: (query) => (typeof query.state.data?.timestamp === 'number' ? Infinity : 30_000),
    retry: false,
  });
}

export function formatDurationSeconds(
  seconds: number,
  options?: { readonly signed?: boolean },
): string {
  const prefix = options?.signed ? '+' : '';
  const whole = Math.round(seconds);
  if (whole <= 0) return `${prefix}<1s`;
  if (whole < 60) return `${prefix}${whole}s`;
  if (whole < 3600) {
    const mins = Math.floor(whole / 60);
    const rem = whole % 60;
    return rem === 0 ? `${prefix}${mins}m` : `${prefix}${mins}m ${rem}s`;
  }
  const hrs = Math.floor(whole / 3600);
  const mins = Math.floor((whole % 3600) / 60);
  return mins === 0 ? `${prefix}${hrs}h` : `${prefix}${hrs}h ${mins}m`;
}

const utcTimestampFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZone: 'UTC',
});

export function formatBlockTimestamp(timestamp: number): string {
  return `${utcTimestampFormatter.format(new Date(timestamp * 1000))} UTC`;
}

export function shortHex(hash: Hex): string {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

export type LatencyRole = 'automation' | 'funds' | 'neutral';

export interface ComputedLatencyHop {
  readonly id: 'origin-decision' | 'decision-settlement';
  readonly label: string;
  readonly seconds: number | null;
  readonly formatted: string;
  readonly role: LatencyRole;
  readonly pending: boolean;
  readonly share: number;
}

export interface ProofLatencySummary {
  readonly hops: readonly ComputedLatencyHop[];
  readonly totalSeconds: number | null;
  readonly formattedTotal: string | null;
  readonly clockSkewDetected: boolean;
  readonly hasAnyTiming: boolean;
  readonly isComplete: boolean;
}

export interface ComputeProofLatencyInput {
  readonly originTimestamp: number | null;
  readonly decisionTimestamp: number | null;
  readonly settlementTimestamp: number | null;
  readonly hasOriginTx: boolean;
  readonly hasSettlementTx: boolean;
  readonly settlementPending?: boolean;
  readonly decisionShortName: string;
}

const MAX_TOLERATED_CLOCK_SKEW_SECONDS = 3;

function computeDelta(
  from: number | null,
  to: number | null,
): { readonly seconds: number | null; readonly skewed: boolean } {
  if (from === null || to === null) return { seconds: null, skewed: false };
  const diff = to - from;
  if (diff >= 0) return { seconds: diff, skewed: false };
  if (diff >= -MAX_TOLERATED_CLOCK_SKEW_SECONDS) return { seconds: 0, skewed: true };
  return { seconds: null, skewed: true };
}

export function computeProofLatency({
  originTimestamp,
  decisionTimestamp,
  settlementTimestamp,
  hasOriginTx,
  hasSettlementTx,
  settlementPending = false,
  decisionShortName,
}: ComputeProofLatencyInput): ProofLatencySummary {
  let clockSkewDetected = false;

  const rawHops: Array<{
    id: 'origin-decision' | 'decision-settlement';
    label: string;
    seconds: number | null;
    role: LatencyRole;
    pending: boolean;
  }> = [];

  if (hasOriginTx) {
    const hop1 = computeDelta(originTimestamp, decisionTimestamp);
    if (hop1.skewed) clockSkewDetected = true;
    rawHops.push({
      id: 'origin-decision',
      label: `Origin -> ${decisionShortName}`,
      seconds: hop1.seconds,
      role: 'automation',
      pending: false,
    });
  }

  const hop2 = computeDelta(decisionTimestamp, settlementTimestamp);
  if (hop2.skewed) clockSkewDetected = true;
  rawHops.push({
    id: 'decision-settlement',
    label: `${decisionShortName} -> Settlement`,
    seconds: hop2.seconds,
    role: 'funds',
    pending: !hasSettlementTx && settlementPending,
  });

  const totalDelta = hasOriginTx
    ? computeDelta(originTimestamp, settlementTimestamp)
    : computeDelta(decisionTimestamp, settlementTimestamp);
  if (totalDelta.skewed) clockSkewDetected = true;

  const totalSeconds = hasSettlementTx ? totalDelta.seconds : null;
  const formattedTotal =
    totalSeconds !== null ? formatDurationSeconds(totalSeconds, { signed: false }) : null;

  const weights = rawHops.map((hop) => (hop.seconds !== null ? Math.max(hop.seconds, 0.5) : 0.75));
  const weightSum = weights.reduce((acc, value) => acc + value, 0);

  const hops: ComputedLatencyHop[] = rawHops.map((hop, index) => {
    const share = weightSum > 0 ? (weights[index] ?? 0) / weightSum : 1 / rawHops.length;
    const formatted =
      hop.seconds !== null
        ? formatDurationSeconds(hop.seconds, { signed: true })
        : hop.pending
          ? 'Pending'
          : 'Unavailable';
    return {
      ...hop,
      formatted,
      share,
    };
  });

  const hasAnyTiming = hops.some((hop) => hop.seconds !== null);
  const isComplete = hasSettlementTx && totalSeconds !== null;

  return {
    hops,
    totalSeconds,
    formattedTotal,
    clockSkewDetected,
    hasAnyTiming,
    isComplete,
  };
}
