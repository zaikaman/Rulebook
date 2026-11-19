import {
  agentAbi,
  agentFactoryAbi,
  encodeAddRuleParams,
  LASNA_CHAIN_ID,
  ruleParamsHash,
  supportedTemplatesFor,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  vaultAbi,
  type Address,
  type Listing,
  type RuleParams,
} from '@rulebook/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { useAccount, useReadContract, useSendTransaction } from 'wagmi';

import { api } from '../lib/api.js';
import { cloneGuard, ruleParamsFromStoredRule, type CloneGuardResult } from '../lib/clone.js';
import { AGENT_FACTORY_ADDRESS } from '../lib/contracts.js';
import { describeError, isWalletRejection } from '../lib/errors.js';
import { ruleIdFromLogs } from '../lib/receipts.js';
import { assertRuleFunding, RuleFundingError } from '../lib/ruleFunding.js';
import { ruleSentence } from '../lib/rules.js';
import { signatureDetails } from '../lib/signatures.js';
import { estimateAddRuleGas, lasnaPublicClient } from '../lib/wagmi.js';
import { useChainGuard } from './useChainGuard.js';

const ZERO = '0x0000000000000000000000000000000000000000';
const SUPPORTED_TEMPLATES = supportedTemplatesFor(UNICHAIN_SEPOLIA_CHAIN_ID);

export type CloneStatus = 'idle' | 'simulating' | 'signing' | 'confirming' | 'confirmed' | 'failed';

export type CloneFailureKind = 'guard' | 'funding' | 'simulation' | 'wallet' | 'chain';

export interface CloneRuleError {
  readonly kind: CloneFailureKind;
  readonly message: string;
  readonly selector: string | null;
  readonly needsDeposit?: boolean;
}

export interface CloneRuleResult {
  readonly txHash: `0x${string}`;
  readonly ruleId: bigint | null;
}

export interface CloneRuleState {
  readonly status: CloneStatus;
  readonly error: CloneRuleError | null;
  readonly result: CloneRuleResult | null;
}

interface CloneParams {
  readonly agent: Address | null;
  readonly params: RuleParams | null;
  /** The author's sentence rebuilt from the published parameters, shown before signing. */
  readonly sentence: string | null;
  /** Every precondition, or null while the account/rule reads are still in flight. */
  readonly guard: CloneGuardResult | null;
  readonly loading: boolean;
  readonly canClone: boolean;
  readonly busy: boolean;
  readonly status: CloneStatus;
  readonly error: CloneRuleError | null;
  readonly result: CloneRuleResult | null;
  readonly clone: () => Promise<CloneRuleResult | null>;
}

const IDLE: CloneRuleState = { status: 'idle', error: null, result: null };

function fundingFailure(error: RuleFundingError): CloneRuleError {
  return {
    kind: 'funding',
    message: error.message,
    selector: null,
    needsDeposit: error.needsDeposit,
  };
}

/**
 * The one-click clone: rebuild the author's exact parameters, prove them against the hash the
 * registry published, then create the rule on the connected wallet's own Agent. The clone is
 * never published, so a copy can never become a listing of its own.
 */
export function useCloneRule(listing: Listing, enabled = true): CloneParams {
  const { address } = useAccount();
  const requestSignature = useChainGuard();
  const { sendTransactionAsync } = useSendTransaction();
  const queryClient = useQueryClient();
  const [state, setState] = useState<CloneRuleState>(IDLE);

  const owner = (address?.toLowerCase() as Address | undefined) ?? ZERO;

  const agentQuery = useReadContract({
    address: AGENT_FACTORY_ADDRESS ?? ZERO,
    abi: agentFactoryAbi,
    functionName: 'agentOf',
    args: [owner],
    chainId: LASNA_CHAIN_ID,
    query: { enabled: Boolean(enabled && address && AGENT_FACTORY_ADDRESS) },
  });
  const agent = agentQuery.data && agentQuery.data !== ZERO ? agentQuery.data : null;

  const detailQuery = useQuery({
    queryKey: ['clone', listing.agent, listing.rule_id.toString()],
    queryFn: () => api.ruleDetail(listing.agent, listing.rule_id.toString()),
    enabled: Boolean(enabled),
    retry: false,
  });

  const countQuery = useReadContract({
    address: agent ?? ZERO,
    abi: agentAbi,
    functionName: 'activeRuleCount',
    chainId: LASNA_CHAIN_ID,
    query: { enabled: Boolean(agent) },
  });

  const vaultQuery = useReadContract({
    address: agent ?? ZERO,
    abi: agentAbi,
    functionName: 'getVault',
    args: [BigInt(UNICHAIN_SEPOLIA_CHAIN_ID)],
    chainId: LASNA_CHAIN_ID,
    query: { enabled: Boolean(agent) },
  });
  const vault = vaultQuery.data && vaultQuery.data !== ZERO ? vaultQuery.data : null;

  const ceilingQuery = useReadContract({
    address: vault ?? ZERO,
    abi: vaultAbi,
    functionName: 'maxSpendPerRun',
    chainId: UNICHAIN_SEPOLIA_CHAIN_ID,
    query: { enabled: Boolean(vault) },
  });

  const rule = detailQuery.data?.rule ?? null;
  const params = useMemo(() => (rule ? ruleParamsFromStoredRule(rule) : null), [rule]);
  const sentence = useMemo(() => (rule ? ruleSentence(rule) : null), [rule]);

  const guard = useMemo<CloneGuardResult | null>(() => {
    if (!enabled) return null;
    if (agentQuery.isLoading) return null;
    if (!agent) {
      return cloneGuard({
        hasAgent: false,
        activeRuleCount: 0,
        template: listing.template,
        supportedTemplates: SUPPORTED_TEMPLATES,
        vaultCeiling: null,
        amountIn: 0n,
        paramsHash: null,
        expectedHash: null,
      });
    }
    if (!params) return null;
    if (countQuery.isLoading) return null;
    return cloneGuard({
      hasAgent: true,
      activeRuleCount: Number(countQuery.data ?? 0n),
      template: params.template,
      supportedTemplates: SUPPORTED_TEMPLATES,
      vaultCeiling: ceilingQuery.data ?? null,
      amountIn: params.amountIn,
      paramsHash: ruleParamsHash(params),
      expectedHash: listing.params_hash ?? null,
    });
  }, [
    agent,
    agentQuery.isLoading,
    ceilingQuery.data,
    countQuery.data,
    countQuery.isLoading,
    enabled,
    listing.params_hash,
    listing.template,
    params,
  ]);

  const clone = useCallback(async (): Promise<CloneRuleResult | null> => {
    if (!agent || !params) {
      setState({
        status: 'failed',
        error: {
          kind: 'guard',
          message: 'The published rule or your account is not ready yet.',
          selector: null,
        },
        result: null,
      });
      return null;
    }
    if (!guard || !guard.ok) {
      setState({
        status: 'failed',
        error: {
          kind: 'guard',
          message: guard?.message ?? 'This rule cannot be cloned yet.',
          selector: null,
        },
        result: null,
      });
      return null;
    }

    setState({ status: 'simulating', error: null, result: null });

    let data: `0x${string}`;
    try {
      data = encodeAddRuleParams(agent, params, { makePublic: false });
      await assertRuleFunding(agent, params);
    } catch (error) {
      setState({
        status: 'failed',
        error:
          error instanceof RuleFundingError
            ? fundingFailure(error)
            : {
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
            'The simulation failed, so nothing was sent. Your account may not be ready.',
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
        signatureDetails.clone(agent, params, sentence ?? ''),
        address,
        (connector) =>
          sendTransactionAsync({
            connector,
            to: agent,
            data,
            account: address,
            chainId: LASNA_CHAIN_ID,
            gas,
          }),
        undefined,
        () => assertRuleFunding(agent, params),
      );
    } catch (error) {
      setState({
        status: 'failed',
        error:
          error instanceof RuleFundingError
            ? fundingFailure(error)
            : isWalletRejection(error)
              ? {
                  kind: 'wallet',
                  message: 'You rejected the signature, so the rule was not cloned.',
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
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['rules', agent] }),
        queryClient.invalidateQueries({ queryKey: ['rule', agent] }),
        queryClient.invalidateQueries({ queryKey: ['marketplace'] }),
        queryClient.invalidateQueries({ queryKey: ['leaderboard'] }),
      ]);
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
  }, [
    address,
    agent,
    guard,
    params,
    queryClient,
    requestSignature,
    sendTransactionAsync,
    sentence,
  ]);

  const busy =
    state.status === 'simulating' || state.status === 'signing' || state.status === 'confirming';

  return {
    agent,
    params,
    sentence,
    guard,
    loading: enabled && (agentQuery.isLoading || detailQuery.isLoading),
    canClone: Boolean(guard?.ok) && !busy && state.status !== 'confirmed',
    busy,
    status: state.status,
    error: state.error,
    result: state.result,
    clone,
  };
}
