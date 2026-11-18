import {
  encodeAddRuleParams,
  LASNA_CHAIN_ID,
  readableSentence,
  ruleParamsFromDraft,
  type Address,
  type RuleParams,
} from '@rulebook/shared';
import { useCallback, useState } from 'react';
import { useAccount, useSendTransaction } from 'wagmi';

import type { ReadyDraft } from '../composer/types.js';
import { describeError, isWalletRejection } from '../lib/errors.js';
import { ruleIdFromLogs } from '../lib/receipts.js';
import { signatureDetails } from '../lib/signatures.js';
import { estimateAddRuleGas, lasnaPublicClient } from '../lib/wagmi.js';
import { useChainGuard } from './useChainGuard.js';

export type CreateFailureKind = 'simulation' | 'wallet' | 'chain';

export interface CreateRuleError {
  readonly kind: CreateFailureKind;
  readonly message: string;
  readonly selector: string | null;
}

export type CreateRuleStatus =
  'idle' | 'simulating' | 'signing' | 'confirming' | 'confirmed' | 'failed';

export interface CreateRuleResult {
  readonly txHash: `0x${string}`;
  readonly ruleId: bigint | null;
}

export interface CreateRuleState {
  readonly status: CreateRuleStatus;
  readonly error: CreateRuleError | null;
  readonly result: CreateRuleResult | null;
}

/**
 * Creates a rule from a checked draft: simulate first so a custom error is explained before a
 * signature, then send the exact calldata the page previewed, then wait for the Lasna receipt.
 * A simulated failure and a wallet rejection are reported as different states.
 */
export function useCreateRule() {
  const { address } = useAccount();
  const requestSignature = useChainGuard();
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
    async (
      agent: Address,
      draft: ReadyDraft,
      makePublic = false,
    ): Promise<CreateRuleResult | null> => {
      setState({ status: 'simulating', error: null, result: null });

      let data: `0x${string}`;
      let params: RuleParams;
      try {
        params = ruleParamsFromDraft(draft);
        data = encodeAddRuleParams(agent, params, { makePublic });
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
        const gas = await estimateAddRuleGas(agent, data, address);
        hash = await requestSignature(
          signatureDetails.create(agent, params, readableSentence(draft), makePublic),
          address,
          () =>
            sendTransactionAsync({
              to: agent,
              data,
              account: address,
              chainId: LASNA_CHAIN_ID,
              gas,
            }),
        );
      } catch (error) {
        setState({
          status: 'failed',
          error: isWalletRejection(error)
            ? {
                kind: 'wallet',
                message: 'You rejected the signature, so the rule was not created.',
                selector: null,
              }
            : {
                kind: 'wallet',
                message:
                  error instanceof Error
                    ? error.message
                    : 'The wallet could not send the transaction.',
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
    [address, requestSignature, sendTransactionAsync],
  );

  return { ...state, create, reset };
}
