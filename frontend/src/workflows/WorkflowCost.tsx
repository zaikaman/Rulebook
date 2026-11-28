import { feeCreditWarningThreshold, getChain, isFundsChain } from '@rulebook/shared';
import {
  ArrowRight01Icon,
  ArrowUpRight01Icon,
  Coins01Icon,
  FlashIcon,
  GitBranchIcon,
  InformationCircleIcon,
  Pulse01Icon,
  Wallet01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useQueries } from '@tanstack/react-query';
import { Link } from 'react-router';
import { formatEther, formatGwei } from 'viem';

import { NetworkBadge } from '@/components/NetworkBadge';
import { PageHeading } from '@/components/chrome/PageHeading';
import { useNetworkMode, withNetworkQuery } from '@/lib/networkMode';
import { appRoutes } from '@/lib/routes';
import { workflowClient } from './chainV2';
import { workflowCreditsFor } from './WorkflowCredit';

function formatGasGwei(wei: bigint): string {
  const numeric = Number(formatGwei(wei));
  if (!Number.isFinite(numeric)) return formatGwei(wei);
  if (numeric > 0 && numeric < 0.0001) return '< 0.0001';
  return numeric.toLocaleString('en-US', {
    maximumFractionDigits: numeric < 0.1 ? 4 : 2,
  });
}

const factorRows = [
  {
    icon: Pulse01Icon,
    title: 'Trigger frequency',
    copy: 'Frequent schedules and busy event sources can use watching credit faster.',
  },
  {
    icon: GitBranchIcon,
    title: 'Checks and actions',
    copy: 'The evaluated branch determines the work done. Trading and transfers also use the assets held in your vault, within the limits you approved.',
  },
  {
    icon: Wallet01Icon,
    title: 'Wallet approvals',
    copy: 'Setup, activation, edits, and deposits have their own wallet transaction fees. Review those fees when signing.',
  },
] as const;

export function WorkflowCost() {
  const { mode } = useNetworkMode();
  const workflowCredits = workflowCreditsFor(mode);
  const prices = useQueries({
    queries: workflowCredits.map(({ chain }) => ({
      queryKey: ['workflow-v2', 'gas-price', mode, chain],
      queryFn: () => workflowClient(chain).getGasPrice(),
      staleTime: 30_000,
      refetchInterval: 60_000,
      retry: 1,
    })),
  });

  return (
    <section className="app-page">
      <PageHeading
        title="Workflow costs"
        description="See which balances pay for your workflows and what changes the cost of a run."
        aside={
          <Link
            className="app-button app-button--primary"
            to={withNetworkQuery(appRoutes.account, mode)}
          >
            <HugeiconsIcon icon={Wallet01Icon} size={16} aria-hidden="true" />
            Open Account &amp; Vault
          </Link>
        }
      />

      <section className="app-panel rb-cost-ledger" aria-labelledby="credit-cost">
        <header className="rb-panel-head">
          <div className="rb-cost-heading">
            <span className="rb-cost-mark" aria-hidden="true">
              <HugeiconsIcon icon={Coins01Icon} size={18} strokeWidth={1.7} />
            </span>
            <div>
              <h2 id="credit-cost" className="rb-panel-title">
                {workflowCredits.length > 2 ? 'Fee credits by network' : 'Two balances, two jobs'}
              </h2>
              <p className="rb-panel-copy">
                Credit is shared by workflows owned by the same wallet. Suggested reserves are
                refill thresholds. Actual charges depend on the workflow and network.
              </p>
            </div>
          </div>
        </header>

        <div className="rb-cost-lanes">
          {workflowCredits.map(({ kind, title, unit, chain }, index) => {
            const price = prices[index]!;
            const role = kind === 'watching' ? 'automation' : 'funds';
            const gasState = price.isError
              ? price.data !== undefined
                ? 'Last reported'
                : 'Unavailable'
              : price.isPending
                ? 'Checking'
                : 'Live';

            return (
              <section
                className="rb-cost-lane"
                key={`${kind}-${chain}`}
                data-chain-role={role}
                aria-label={kind === 'watching' ? title : `${title} (${getChain(chain).name})`}
              >
                <header className="rb-cost-lane-head">
                  <span className="rb-cost-lane-icon" aria-hidden="true">
                    <HugeiconsIcon
                      icon={role === 'automation' ? FlashIcon : Wallet01Icon}
                      size={19}
                      strokeWidth={1.7}
                    />
                  </span>
                  <div className="rb-cost-lane-identity">
                    <h3 className="rb-cost-lane-title">{title}</h3>
                    <NetworkBadge chainId={chain} />
                  </div>
                  <span
                    className="rb-cost-live"
                    data-state={price.isError ? 'stale' : price.isPending ? 'pending' : 'live'}
                  >
                    <span className="rb-cost-live-dot" aria-hidden="true" />
                    {gasState}
                  </span>
                </header>

                <p className="rb-cost-lane-copy">
                  {kind === 'watching'
                    ? 'Funds trigger evaluations by your agent. Matching events can consume credit while the conditions are being checked.'
                    : 'Funds callbacks that settle in your vault. A branch with more actions can use more gas.'}
                </p>

                <dl className="rb-cost-lane-facts">
                  <div>
                    <dt>Suggested reserve</dt>
                    <dd className="rb-cost-reserve">
                      {formatEther(feeCreditWarningThreshold(chain))}
                      <span>{unit}</span>
                    </dd>
                  </div>
                  <div>
                    <dt>
                      {price.isError && price.data !== undefined ? 'Last gas price' : 'Gas price'}
                    </dt>
                    <dd
                      className="rb-cost-gas"
                      title={
                        price.data !== undefined ? `${formatGwei(price.data)} gwei` : undefined
                      }
                    >
                      {price.data !== undefined ? (
                        <>
                          {formatGasGwei(price.data)}
                          <span>gwei</span>
                        </>
                      ) : price.isPending ? (
                        'Checking…'
                      ) : (
                        'Unavailable'
                      )}
                    </dd>
                  </div>
                </dl>

                {price.isError && (
                  <button
                    type="button"
                    className="rb-cost-refresh"
                    disabled={price.isFetching}
                    onClick={() => void price.refetch()}
                  >
                    {price.isFetching ? 'Checking gas price…' : 'Check gas price again'}
                  </button>
                )}

                <footer className="rb-cost-lane-foot">
                  <Link
                    className="app-button"
                    to={withNetworkQuery(
                      `${appRoutes.account}?credit=${kind}${isFundsChain(chain) ? `&chain=${chain}` : ''}`,
                      mode,
                    )}
                  >
                    Add {title.toLowerCase()}
                    <HugeiconsIcon icon={ArrowRight01Icon} size={15} aria-hidden="true" />
                  </Link>
                </footer>
              </section>
            );
          })}
        </div>
      </section>

      <section className="app-panel rb-cost-factors" aria-labelledby="workflow-cost-factors">
        <header className="rb-panel-head">
          <div>
            <h2 id="workflow-cost-factors" className="rb-panel-title">
              What changes the cost
            </h2>
            <p className="rb-panel-copy">
              A run can consume more of one balance than another depending on the path it takes.
            </p>
          </div>
          <span className="rb-cost-factors-mark" aria-hidden="true">
            <HugeiconsIcon icon={InformationCircleIcon} size={17} strokeWidth={1.7} />
          </span>
        </header>

        <div className="rb-panel-body">
          <dl className="rb-cost-factor-list">
            {factorRows.map(({ icon, title, copy }) => (
              <div className="rb-cost-factor" key={title}>
                <dt>
                  <span className="rb-cost-factor-icon" aria-hidden="true">
                    <HugeiconsIcon icon={icon} size={16} strokeWidth={1.7} />
                  </span>
                  <span>{title}</span>
                </dt>
                <dd>{copy}</dd>
              </div>
            ))}
          </dl>
        </div>

        <footer className="rb-cost-factors-foot">
          <div className="rb-cost-proof-note">
            <HugeiconsIcon icon={InformationCircleIcon} size={15} aria-hidden="true" />
            <p>
              A workflow proof can show execution gas from the transaction receipts. The credit
              system can apply its own billing parameters, and settlement transactions can also
              incur data fees.
            </p>
          </div>
          <Link className="app-button" to={withNetworkQuery(appRoutes.proof, mode)}>
            Open workflow proof
            <HugeiconsIcon icon={ArrowUpRight01Icon} size={14} aria-hidden="true" />
          </Link>
        </footer>
      </section>
    </section>
  );
}
