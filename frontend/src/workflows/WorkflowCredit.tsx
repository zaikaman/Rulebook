import {
  executionCreditAbi,
  feeCreditWarningThreshold,
  getChain,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  workflowVaultFactoryV2Abi,
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

import { appRoutes } from '@/lib/routes';
import {
  readAgent,
  readVault,
  settlementFactory,
  workflowClient,
  workflowV2Deployment,
} from './chainV2';

export const workflowCredits = [
  { kind: 'watching', title: 'Watching credit', unit: 'lREACT', chain: LASNA_CHAIN_ID },
  { kind: 'execution', title: 'Execution credit', unit: 'ETH', chain: UNICHAIN_SEPOLIA_CHAIN_ID },
] as const;

type CreditBalance = { reserve: bigint; debt: bigint; blockNumber: bigint };

const creditIcons = {
  watching: Pulse01Icon,
  execution: FlashIcon,
} as const;

async function readCredit(
  owner: Address,
  chain: (typeof workflowCredits)[number]['chain'],
  previous: CreditBalance | null | undefined,
): Promise<CreditBalance | null> {
  const client = workflowClient(chain);
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  // A slower RPC node must not overwrite a balance already read at a newer block.
  if (previous && previous.blockNumber > blockNumber) return previous;
  const lasna = chain === LASNA_CHAIN_ID;
  const beneficiary = await (lasna
    ? readAgent(owner, blockNumber)
    : readVault(owner, chain, blockNumber));
  if (beneficiary === zeroAddress) return null;
  const target = lasna
    ? getChain(LASNA_CHAIN_ID).systemContract
    : await client.readContract({
        address: settlementFactory()!,
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

export function WorkflowCreditNotice({
  owner,
  review = false,
}: {
  owner?: Address;
  review?: boolean;
}) {
  const enabled = Boolean(owner && workflowV2Deployment);
  const credits = useQueries({
    queries: workflowCredits.map(({ chain }) => ({
      queryKey: ['workflow-v2', 'fee-credit', owner?.toLowerCase(), chain],
      enabled,
      queryFn: ({ client, queryKey }) =>
        readCredit(owner!, chain, client.getQueryData<CreditBalance | null>(queryKey)),
      refetchInterval: 12_000,
      retry: 1,
    })),
  });
  if (!enabled) return null;
  const attention = workflowCredits.flatMap((credit, index) => {
    const result = credits[index]!;
    const balance = result.data;
    const minimum = feeCreditWarningThreshold(credit.chain);
    if (!balance || (balance.debt === 0n && balance.reserve >= minimum)) return [];
    return [{ credit, ...balance, minimum, stale: result.isError }];
  });
  const unavailable = credits.some((result) => result.isError);
  const needsSetup = credits.some((result) => result.data === null);
  const checking = credits.some((result) => result.isPending);
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
              : 'Credit pays for trigger monitoring on Reactive Lasna and settlement on Unichain Sepolia.'}
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
            <Link className="app-link" to={appRoutes.account}>
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
                  key={credit.kind}
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
                      to={`${appRoutes.account}?credit=${credit.kind}`}
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
              onClick={() => credits.forEach(({ refetch }) => void refetch())}
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
