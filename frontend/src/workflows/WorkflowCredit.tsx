import {
  executionCreditAbi,
  feeCreditWarningThreshold,
  getChain,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  workflowVaultFactoryV2Abi,
} from '@rulebook/shared';
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

  return (
    <section
      className={review ? 'app-divider space-y-3 pt-3' : 'app-panel app-panel-pad space-y-3'}
      aria-label="Workflow fee credit"
    >
      <h2 className="app-panel-heading">Workflow fee credit</h2>
      {checking && review && (
        <p className="app-copy" role="status">
          Checking network credit…
        </p>
      )}
      {needsSetup && review && (
        <p className="app-copy">
          Add watching and execution credit after your account and vault are created.{' '}
          <Link className="app-link" to={appRoutes.account}>
            Open Account &amp; Vault
          </Link>
        </p>
      )}
      {attention.length > 0 && (
        <>
          <p className="app-copy">
            Low reserves or outstanding fees can delay a run even while the workflow is active.
          </p>
          <ul className="grid gap-3">
            {attention.map(({ credit, reserve, debt, minimum, stale }) => (
              <li key={credit.kind} className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">
                    {credit.title} · {debt > 0n ? 'Fees due' : 'Low'}
                  </p>
                  <p className="app-copy">
                    {stale ? 'Last read ' : 'Reserve '}
                    {formatEther(reserve)} {credit.unit}
                    {debt > 0n ? ` · Owed ${formatEther(debt)} ${credit.unit}` : ''}
                    {` · Suggested reserve ${formatEther(minimum)} ${credit.unit}`}
                  </p>
                </div>
                <Link className="app-link" to={`${appRoutes.account}?credit=${credit.kind}`}>
                  Add {credit.title.toLowerCase()}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      {unavailable && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="app-copy" role="status">
            Some credit balances could not be checked.
          </p>
          <button
            className="app-button"
            type="button"
            onClick={() => credits.forEach(({ refetch }) => void refetch())}
          >
            Check again
          </button>
        </div>
      )}
    </section>
  );
}
