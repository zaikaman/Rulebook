import { agentAbi } from '@rulebook/shared';
import { decodeEventLog } from 'viem';

export interface ReceiptLog {
  readonly data: `0x${string}`;
  readonly topics: readonly `0x${string}`[];
}

/** The new rule id from an `addRule` receipt, or null when the log set carries none. */
export function ruleIdFromLogs(logs: ReadonlyArray<ReceiptLog>): bigint | null {
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: agentAbi,
        data: log.data,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
      }) as { eventName?: string; args?: { ruleId?: bigint } };
      if (decoded.eventName === 'RuleCreated' && decoded.args?.ruleId !== undefined) {
        return decoded.args.ruleId;
      }
    } catch {
      // Not an Agent event; the receipt may carry logs from other contracts.
    }
  }
  return null;
}
