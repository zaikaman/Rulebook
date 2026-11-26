import {
  networkModeForChain,
  isFundsChain,
  type WeeklyBudgetAmounts,
  type WorkflowV2Program,
} from '@rulebook/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { Address } from 'viem';

import { withNetworkQuery } from '@/lib/networkMode';
import { appRoutes } from '@/lib/routes';
import { Button, Callout, PanelCopy } from '@/ui';
import { readFundsV2, settlementFactory, type SettlementChain } from './chainV2';
import { workflowFundingIssues } from './fundingV2';

export function useWorkflowFunding(
  owner: Address | undefined,
  program: WorkflowV2Program | undefined,
  budget: WeeklyBudgetAmounts | undefined,
) {
  const chain: SettlementChain | undefined =
    program && isFundsChain(program.chain) ? program.chain : undefined;
  const query = useQuery({
    queryKey: ['workflow-v2', 'funding-check', owner?.toLowerCase(), chain],
    enabled: Boolean(owner && chain && budget && settlementFactory(chain)),
    queryFn: () => readFundsV2(owner!, chain!),
    refetchInterval: 12_000,
    retry: 1,
  });
  const issues =
    query.data && program && budget ? workflowFundingIssues(program, budget, query.data) : [];
  // Activation creates a missing Vault, so only an existing Vault that cannot cover a run blocks
  // activation. A missing Vault is still surfaced so the owner can fund it before the first run.
  const blocking = issues.filter((issue) => issue.code !== 'vault-missing');
  const blocked =
    Boolean(owner && program && budget) &&
    (query.isPending || query.isError || blocking.length > 0);
  return { chain, query, issues, blocked };
}

export function WorkflowFundingNotice({
  owner,
  funding,
  onEdit,
}: {
  owner?: Address;
  funding: ReturnType<typeof useWorkflowFunding>;
  onEdit: () => void;
}) {
  const chain = funding.chain;
  if (!owner || !chain || !settlementFactory(chain)) return null;
  const { query, issues } = funding;

  if (query.isPending) {
    return <PanelCopy role="status">Checking Vault funding…</PanelCopy>;
  }

  if (query.isError) {
    return (
      <Callout
        title="Could not check Vault funding"
        action={
          <Button onClick={() => void query.refetch()} disabled={query.isFetching}>
            {query.isFetching ? 'Checking…' : 'Check again'}
          </Button>
        }
      >
        <p>Activation is paused until the Vault balances can be read.</p>
      </Callout>
    );
  }

  if (!issues.length) return null;

  const account = issues.some((issue) => issue.recovery === 'account');
  const limits = issues.some((issue) => issue.recovery === 'limits');
  const missingVault = issues.every((issue) => issue.code === 'vault-missing');
  const title = missingVault
    ? 'Your Vault will be created on activation'
    : account
      ? limits
        ? 'Fund the Vault and fix the limits'
        : 'Fund the Vault before activation'
      : 'Fix the limits before activation';

  return (
    <Callout
      title={title}
      action={
        account ? (
          <Link
            className="app-button"
            to={withNetworkQuery(`${appRoutes.account}?chain=${chain}`, networkModeForChain(chain))}
          >
            Open Account &amp; Vault
          </Link>
        ) : (
          <Button onClick={onEdit}>Edit workflow</Button>
        )
      }
    >
      {issues.map((issue) => (
        <p key={issue.code}>{issue.message}</p>
      ))}
    </Callout>
  );
}
