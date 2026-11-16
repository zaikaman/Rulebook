import { agentAbi, encodeAddRule, LASNA_CHAIN_ID, type Address } from '@rulebook/shared';
import { useCallback, useState } from 'react';
import { decodeEventLog } from 'viem';
import { useAccount, useSendTransaction, useSwitchChain } from 'wagmi';

import type { ReadyDraft } from '../composer/types.js';
import { describeError } from '../lib/errors.js';
import { lasnaPublicClient } from '../lib/wagmi.js';

export type CreateFailureKind = 'simulation' | 'wallet' | 'chain';

export interface CreateRuleError {
  readonly kind: CreateFailureKind;
  readonly message: string;
  readonly selector: string | null;
}

export type CreateRuleStatus =
  | 'idle'
  | 'simulating'
  | 'signing'
  | 'confirming'
  | 'confirmed'
  | 'failed';

export interface CreateRuleResult {
  readonly txHash: `0x${string}`;
  readonly ruleId: bigint | null;
}

export interface CreateRuleState {
  readonly status: CreateRuleStatus;
  readonly error: CreateRuleError | null;
  readonly result: CreateRuleResult | null;
}

const REJECTION = /rejected|denied|cancelled|canceled/i;

function isWalletRejection(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const name = (error as { name?: string }).name;
    if (name === 'UserRejectedRequestError') return true;
  }
  return error instanceof Error && REJECTION.test(error.message);
}

function ruleIdFromLogs(
  logs: ReadonlyArray<{ readonly data: `0x${string}`; readonly topics: readonly `0x${string}`[] }>,
): bigint | null {
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

/**
 * Creates a rule from a checked draft: simulate first so a custom error is explained before a
 * signature, then send the exact calldata the page previewed, then wait for the Lasna receipt.
 * A simulated failure and a wallet rejection are reported as different states.
 */
export function useCreateRule() {
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const [state, setState] = useState<CreateRuleState>({
    status: 'idle',
    error: null,
    result: null,
  });

  const reset = useCallback(() => {
    setState({ status: 'idle', error: null, result: null });
  }, []);

  const create = useCallback(
    async (agent: Address, draft: ReadyDraft): Promise<CreateRuleResult | null> => {
      setState({ status: 'simulating', error: null, result: null });

      let data: `0x${string}`;
      try {
        data = encodeAddRule(agent, draft);
      } catch (error) {
        setState({
          status: 'failed',
          error: {
            kind: 'simulation',
            message: error instanceof Error ? error.message : 'This rule cannot be encoded.',
            selector: null,
          },
          result: null,
        });
        return null;
      }

      try {
        await lasnaPublicClient.call({
          to: agent,
          data,
          ...(address ? { account: address } : {}),
        });
      } catch (error) {
        const described = describeError(error);
        setState({
          status: 'failed',
          error: {
            kind: 'simulation',
            message:
              described?.message ??
              'The simulation failed, so nothing was sent. Check the values and try again.',
            selector: described?.selector ?? null,
          },
          result: null,
        });
        return null;
      }

      setState({ status: 'signing', error: null, result: null });

      let hash: `0x${string}`;
      try {
        if (chainId !== LASNA_CHAIN_ID) {
          await switchChainAsync({ chainId: LASNA_CHAIN_ID });
        }
        hash = await sendTransactionAsync({ to: agent, data, chainId: LASNA_CHAIN_ID });
      } catch (error) {
        setState({
          status: 'failed',
          error: isWalletRejection(error)
            ? { kind: 'wallet', message: 'You rejected the signature, so the rule was not created.', selector: null }
            : {
                kind: 'wallet',
                message:
                  error instanceof Error ? error.message : 'The wallet could not send the transaction.',
                selector: null,
              },
          result: null,
        });
        return null;
      }

      setState({ status: 'confirming', error: null, result: null });
      try {
        const receipt = await lasnaPublicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== 'success') {
          setState({
            status: 'failed',
            error: { kind: 'chain', message: 'The transaction reverted on Lasna.', selector: null },
            result: null,
          });
          return null;
        }
        const result = { txHash: hash, ruleId: ruleIdFromLogs(receipt.logs) };
        setState({ status: 'confirmed', error: null, result });
        return result;
      } catch (error) {
        setState({
          status: 'failed',
          error: {
            kind: 'chain',
            message:
              error instanceof Error
                ? `The transaction was sent but not confirmed: ${error.message}`
                : 'The transaction was sent but not confirmed.',
            selector: null,
          },
          result: null,
        });
        return null;
      }
    },
    [address, chainId, sendTransactionAsync, switchChainAsync],
  );

  return { ...state, create, reset };
}
