import {
  automationChainFor,
  executionCreditAbi,
  feeCreditWarningThreshold,
  getChain,
  isAutomationChain,
  workflowVaultFactoryV2Abi,
  type AutomationChainId,
  type FundsChainId,
  type NetworkMode,
} from '@rulebook/shared';
import {
  Alert02Icon,
  Coins01Icon,
  FlashIcon,
  InformationCircleIcon,
  Pulse01Icon,
  RefreshIcon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useQueries } from '@tanstack/react-query';
import { Link } from 'react-router';
import { formatEther, zeroAddress, type Address } from 'viem';

import { useNetworkMode } from '@/lib/networkMode';
import { appRoutes } from '@/lib/routes';
import {
  configuredFundsChains,
  readAgent,
  readVault,
  settlementFactory,
  workflowClient,
} from './chainV2';

export interface CreditLaneSpec {
  readonly kind: 'watching' | 'execution';
  readonly title: string;
  readonly unit: 'lREACT' | 'REACT' | 'ETH';
  readonly chain: AutomationChainId | FundsChainId;
}

export function workflowCreditsFor(mode: NetworkMode): readonly CreditLaneSpec[] {
  const autoChain = automationChainFor(mode);
  const auto = getChain(autoChain);
  return [
    { kind: 'watching', title: 'Watching credit', unit: auto.nativeSymbol, chain: autoChain },
    ...configuredFundsChains(mode).map((chain) => ({
      kind: 'execution' as const,
      title: 'Execution credit',
      unit: 'ETH' as const,
      chain,
    })),
  ];
}

export const workflowCredits = workflowCreditsFor('testnet');

export type CreditBalance = { reserve: bigint; debt: bigint; blockNumber: bigint };

export interface WorkflowCreditReading {
  readonly reserve: bigint;
  readonly debt: bigint;
  readonly threshold: bigint;
}

const creditIcons = {
  watching: Pulse01Icon,
  execution: FlashIcon,
} as const;

async function readCredit(
  owner: Address,
  chain: AutomationChainId | FundsChainId,
  mode: NetworkMode,
  previous: CreditBalance | null | undefined,
): Promise<CreditBalance | null> {
  const client = workflowClient(chain);
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  // A slower RPC node must not overwrite a balance already read at a newer block.
  if (previous && previous.blockNumber > blockNumber) return previous;
  const automation = isAutomationChain(chain);
  const beneficiary = await (automation
    ? readAgent(owner, blockNumber, mode)
    : readVault(owner, chain, blockNumber));
  if (beneficiary === zeroAddress) return null;
  const factory = automation ? undefined : settlementFactory(chain);
  if (!automation && !factory) return null;
  const target = automation
    ? getChain(chain).systemContract
    : await client.readContract({
        address: factory!,
        abi: workflowVaultFactoryV2Abi,
        functionName: 'callbackProxy',
        blockNumber,
      });
  const call = { address: target, abi: executionCreditAbi, args: [beneficiary] } as const;
  const [reserve, debt] = await Promise.all([
    client.readContract({ ...call, blockNumber, functionName: 'reserves' }),
    client.readContract({ ...call, blockNumber, functionName: 'debt' }),
  ]);
  return { reserve, debt, blockNumber };
}

function reserveCoverage(reserve: bigint, minimum: bigint) {
  if (minimum <= 0n) return 100;
  const percent = Number((reserve * 100n) / minimum);
  return Math.max(0, Math.min(100, percent));
}

function reading(
  balance: CreditBalance | null | undefined,
  chain: AutomationChainId | FundsChainId,
): WorkflowCreditReading | null {
  return balance
    ? { reserve: balance.reserve, debt: balance.debt, threshold: feeCreditWarningThreshold(chain) }
    : null;
}

/** Shared credit reads for the health surface and the fee notice; React Query dedupes the keys. */
export function useWorkflowCredits(owner?: Address, chain?: FundsChainId) {
  const { mode, automationChainId, defaultFundsChainId, isDeploymentConfigured } = useNetworkMode();
  const lanes = workflowCreditsFor(mode);
  const enabled = Boolean(owner && isDeploymentConfigured);
  const queries = useQueries({
    queries: lanes.map(({ chain: targetChain }) => ({
      queryKey: ['workflow-v2', 'fee-credit', mode, owner?.toLowerCase(), targetChain],
      enabled,
      queryFn: ({ client, queryKey }) =>
        readCredit(owner!, targetChain, mode, client.getQueryData<CreditBalance | null>(queryKey)),
      refetchInterval: 12_000,
      retry: 1,
    })),
  });
  const watching = queries[0]!;
  const execution = queries[1]!;
  const relevantIndices = lanes
    .map((credit, index) =>
      credit.kind === 'watching' || chain === undefined || credit.chain === chain ? index : -1,
    )
    .filter((index) => index >= 0);
  const byChain: Partial<Record<FundsChainId, WorkflowCreditReading | null>> = {};
  lanes.forEach((credit, index) => {
    if (credit.kind === 'execution') {
      byChain[credit.chain as FundsChainId] = reading(queries[index]?.data, credit.chain);
    }
  });
  const relevantQueries = relevantIndices.map((index) => queries[index]!);
  const vaultMissing =
    chain !== undefined
      ? relevantIndices.some(
          (index) => lanes[index]?.kind === 'execution' && queries[index]?.data === null,
        )
      : lanes.every((credit, index) => credit.kind === 'watching' || queries[index]?.data === null);
  return {
    lanes,
    enabled,
    queries,
    relevantIndices,
    watching,
    execution,
    byChain,
    readings: {
      watching: reading(watching.data, automationChainId),
      execution: reading(execution.data, defaultFundsChainId),
    },
    checking: relevantQueries.some((result) => result.isPending),
    unavailable: relevantQueries.some((result) => result.isError),
    needsSetup: watching.data === null || vaultMissing,
  };
}

export function WorkflowCreditNotice({
  owner,
  review = false,
  chain,
}: {
  owner?: Address;
  review?: boolean;
  chain?: FundsChainId;
}) {
  const { mode, automationName } = useNetworkMode();
  const credits = useWorkflowCredits(owner, chain);
  const { lanes, enabled, checking, unavailable, needsSetup, relevantIndices } = credits;
  if (!enabled) return null;
  const attention = relevantIndices.flatMap((index) => {
    const credit = lanes[index]!;
    const result = credits.queries[index];
    const balance = result?.data;
    const minimum = feeCreditWarningThreshold(credit.chain);
    if (!result || !balance || (balance.debt === 0n && balance.reserve >= minimum)) return [];
    return [{ credit, ...balance, minimum, stale: result.isError }];
  });
  if (!attention.length && !unavailable && !(review && (needsSetup || checking))) return null;

  const status = attention.length
    ? { label: 'Action needed', tone: 'paused' as const }
    : unavailable
      ? { label: 'Check failed', tone: 'danger' as const }
      : needsSetup
        ? { label: 'Setup required', tone: 'paused' as const }
        : checking
          ? { label: 'Checking', tone: undefined }
          : undefined;

  return (
    <section
      className={review ? 'rb-fee rb-fee--inline' : 'app-panel rb-fee'}
      aria-label="Workflow fee credit"
    >
      <header className="rb-fee-head">
        <span className="rb-fee-mark" aria-hidden="true">
          <HugeiconsIcon icon={Coins01Icon} size={18} strokeWidth={1.7} />
        </span>
        <div className="rb-fee-heading">
          <div className="rb-fee-title-row">
            <h2 className="app-panel-heading">Workflow fee credit</h2>
            {status && (
              <span className="rb-chip" data-tone={status.tone}>
                {status.label}
              </span>
            )}
          </div>
          <p className="rb-panel-copy">
            {attention.length
              ? 'Low reserves or outstanding fees can delay a run even while the workflow is active.'
              : `Credit pays for trigger monitoring on ${automationName} and settlement on ${configuredFundsChains(
                  mode,
                )
                  .map((id) => getChain(id).name)
                  .join(' and ')}.`}
          </p>
        </div>
      </header>

      <div className="rb-fee-body">
        {checking && review && (
          <p className="rb-fee-status" role="status">
            Checking network credit…
          </p>
        )}
        {needsSetup && review && (
          <p className="rb-fee-status">
            Add watching and execution credit after your account and vault are created.{' '}
            <Link
              className="app-link"
              to={chain ? `${appRoutes.account}?chain=${chain}` : appRoutes.account}
            >
              Open Account &amp; Vault
            </Link>
          </p>
        )}

        {attention.length > 0 && (
          <ul className="rb-fee-lanes">
            {attention.map(({ credit, reserve, debt, minimum, stale }) => {
              const coverage = reserveCoverage(reserve, minimum);
              const chain = getChain(credit.chain);
              const icon = creditIcons[credit.kind];
              return (
                <li
                  className="rb-fee-lane"
                  key={`${credit.kind}-${credit.chain}`}
                  data-chain-role={chain.role}
                  data-state={stale ? 'stale' : debt > 0n ? 'due' : 'low'}
                >
                  <div className="rb-fee-lane-head">
                    <span className="rb-fee-lane-icon" aria-hidden="true">
                      <HugeiconsIcon icon={icon} size={17} strokeWidth={1.8} />
                    </span>
                    <div className="rb-fee-lane-identity">
                      <p className="rb-fee-lane-title">
                        {credit.title}
                        <span data-tone={debt > 0n ? 'danger' : 'paused'}>
                          {' · '}
                          {debt > 0n ? 'Fees due' : 'Low'}
                        </span>
                      </p>
                      <p className="rb-fee-lane-network">
                        {chain.name}
                        <span aria-hidden="true">·</span>
                        {credit.unit}
                      </p>
                    </div>
                    <Link
                      className="app-button rb-fee-action"
                      to={`${appRoutes.account}?credit=${credit.kind}&chain=${credit.chain}`}
                    >
                      Add {credit.title.toLowerCase()}
                    </Link>
                  </div>

                  <dl className="rb-fee-metrics">
                    <div>
                      <dt>{stale ? 'Last read' : 'Reserve'}</dt>
                      <dd>
                        {formatEther(reserve)}
                        <span>{credit.unit}</span>
                      </dd>
                    </div>
                    {debt > 0n && (
                      <div data-tone="danger">
                        <dt>Fees owed</dt>
                        <dd>
                          {formatEther(debt)}
                          <span>{credit.unit}</span>
                        </dd>
                      </div>
                    )}
                    <div>
                      <dt>Suggested reserve</dt>
                      <dd>
                        {formatEther(minimum)}
                        <span>{credit.unit}</span>
                      </dd>
                    </div>
                  </dl>

                  <div className="rb-fee-coverage">
                    <div className="rb-fee-coverage-head">
                      <span>Reserve coverage</span>
                      <span>{coverage}% of suggested</span>
                    </div>
                    <div className="rb-fee-coverage-track" aria-hidden="true">
                      <span style={{ inlineSize: `${coverage}%` }} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {attention.length > 0 && (
          <p className="rb-fee-foot">
            <HugeiconsIcon icon={InformationCircleIcon} size={13} aria-hidden="true" />
            Credit is shared by workflows owned by the same wallet.
          </p>
        )}

        {unavailable && (
          <div className="rb-fee-unavailable">
            <p role="status">
              <HugeiconsIcon icon={Alert02Icon} size={15} aria-hidden="true" />
              Some credit balances could not be checked.
            </p>
            <button
              className="app-button"
              type="button"
              onClick={() => credits.queries.forEach(({ refetch }) => void refetch())}
            >
              <HugeiconsIcon icon={RefreshIcon} size={14} aria-hidden="true" />
              Check again
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
