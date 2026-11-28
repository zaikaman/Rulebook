import {
  estimateCreditRunway,
  estimatedGasPerRunLabel,
  feeCreditWarningThreshold,
  formatRunwayRuns,
  getChain,
  isFundsChain,
} from '@rulebook/shared';
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
import { Link } from 'react-router';
import { formatEther, formatGwei } from 'viem';
import { useAccount } from 'wagmi';

import { NetworkBadge } from '@/components/NetworkBadge';
import { PageHeading } from '@/components/chrome/PageHeading';
import { useNetworkMode, withNetworkQuery } from '@/lib/networkMode';
import { appRoutes } from '@/lib/routes';
import { creditFaucetFor, usdcFaucetFor, type TestnetFaucetInfo } from '@/lib/testnetTokens';
import { Callout, ExternalLink, RunwayReadout, type RunwayReadoutProps } from '@/ui';
import { configuredFundsChains } from './chainV2';
import { formatDisplayGasPrice, useChainGasPrices } from './useGasPrices';
import { useWorkflowCredits, workflowCreditsFor } from './WorkflowCredit';

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
  const { address } = useAccount();
  const workflowCredits = workflowCreditsFor(mode);
  const credits = useWorkflowCredits(address);
  const prices = useChainGasPrices(
    workflowCredits.map(({ chain }) => chain),
    mode,
  );
  const usdcFaucets: TestnetFaucetInfo[] =
    mode === 'testnet'
      ? configuredFundsChains(mode)
          .map((chain) => usdcFaucetFor(chain))
          .filter((token): token is TestnetFaucetInfo => Boolean(token))
      : [];

  return (
    <section className="app-page">
      <PageHeading
        title="Workflow costs"
        description="See how far your credit goes at live gas prices and what changes the cost of a run."
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
                Credit is shared by workflows owned by the same wallet. Runway estimates translate
                reserves and live gas into approximate runs; actual charges depend on the workflow
                and network.
              </p>
            </div>
          </div>
        </header>

        <div className="rb-cost-lanes">
          {workflowCredits.map(({ kind, title, unit, chain }, index) => {
            const price = prices[index]!;
            const role = kind === 'watching' ? 'automation' : 'funds';
            const threshold = feeCreditWarningThreshold(chain);
            const creditQuery = credits.queries[index];
            const creditBalance = creditQuery?.data;
            const hasAccountBalance = creditBalance !== null && creditBalance !== undefined;
            const creditCheckFailed = Boolean(
              address && creditQuery?.isError && !hasAccountBalance,
            );
            const faucet = mode === 'testnet' ? creditFaucetFor(chain) : undefined;
            const gasAssumption = estimatedGasPerRunLabel(kind);

            const gasState = price.isError
              ? price.data !== undefined
                ? 'Last reported'
                : 'Unavailable'
              : price.isPending
                ? 'Checking'
                : 'Live';

            let runwayProps: RunwayReadoutProps;
            if (price.data?.runCostWei) {
              if (hasAccountBalance) {
                const runway = estimateCreditRunway({
                  reserveWei: creditBalance.reserve,
                  debtWei: creditBalance.debt,
                  estimatedCostPerRunWei: price.data.runCostWei,
                });
                const tone: RunwayReadoutProps['tone'] =
                  creditBalance.debt > 0n
                    ? 'danger'
                    : creditBalance.reserve === 0n ||
                        creditBalance.reserve < threshold ||
                        runway?.underOneRun
                      ? 'paused'
                      : runway === null
                        ? 'muted'
                        : 'active';
                const badge: RunwayReadoutProps['badge'] =
                  creditBalance.debt > 0n
                    ? { label: 'Fees due', tone: 'danger' }
                    : creditBalance.reserve === 0n
                      ? { label: 'Unfunded', tone: 'paused' }
                      : creditBalance.reserve < threshold || runway?.underOneRun
                        ? { label: 'Low runway', tone: 'paused' }
                        : { label: 'Funded', tone: 'active' };
                const detail =
                  runway === null
                    ? 'Network fee pricing is unavailable.'
                    : creditBalance.debt > 0n
                      ? `From ${formatEther(creditBalance.reserve)} ${unit} reserve minus ${formatEther(creditBalance.debt)} ${unit} owed · ${gasAssumption}`
                      : `From your ${formatEther(creditBalance.reserve)} ${unit} reserve · ${gasAssumption}`;
                runwayProps = {
                  value: runway ? formatRunwayRuns(runway) : 'Runway unavailable',
                  detail,
                  badge,
                  tone,
                };
              } else {
                const runway = estimateCreditRunway({
                  reserveWei: threshold,
                  estimatedCostPerRunWei: price.data.runCostWei,
                });
                runwayProps = {
                  value: runway ? formatRunwayRuns(runway) : 'Runway unavailable',
                  detail:
                    runway === null
                      ? 'Network fee pricing is unavailable.'
                      : creditCheckFailed
                        ? `Could not read your reserve; showing suggested ${formatEther(threshold)} ${unit} · ${gasAssumption}`
                        : `At suggested ${formatEther(threshold)} ${unit} reserve · ${gasAssumption}`,
                  badge: creditCheckFailed
                    ? { label: 'Balance unavailable', tone: 'paused' }
                    : { label: 'At suggested reserve', plain: true },
                  tone:
                    creditCheckFailed || runway?.underOneRun
                      ? 'paused'
                      : runway === null
                        ? 'muted'
                        : 'default',
                };
              }
            } else if (price.isPending) {
              runwayProps = {
                value: 'Estimating…',
                detail: 'Reading network fee pricing.',
                tone: 'muted',
              };
            } else {
              runwayProps = {
                value: 'Runway unavailable',
                detail: 'Network fee pricing could not be loaded.',
                tone: 'muted',
              };
            }

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

                <RunwayReadout size="featured" {...runwayProps} />

                <dl className="rb-cost-lane-facts">
                  {hasAccountBalance && (
                    <div>
                      <dt>Your reserve</dt>
                      <dd className="rb-cost-reserve">
                        {formatEther(creditBalance.reserve)}
                        <span>{unit}</span>
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>Suggested reserve</dt>
                    <dd className="rb-cost-reserve">
                      {formatEther(threshold)}
                      <span>{unit}</span>
                    </dd>
                  </div>
                  <div>
                    <dt>
                      {price.isError && price.data !== undefined ? 'Last gas price' : 'Gas price'}
                    </dt>
                    <dd
                      className="rb-cost-gas"
                      title={price.data ? `${formatGwei(price.data.gasPriceWei)} gwei` : undefined}
                    >
                      {price.data !== undefined ? (
                        <>
                          {formatDisplayGasPrice(price.data.gasPriceWei)}
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

                {(price.isError || price.data?.runCostWei === null) && (
                  <button
                    type="button"
                    className="rb-cost-refresh"
                    disabled={price.isFetching}
                    onClick={() => void price.refetch()}
                  >
                    {price.isFetching ? 'Checking gas price…' : 'Check network fees again'}
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
                  {faucet && <ExternalLink href={faucet.faucet}>{faucet.linkLabel}</ExternalLink>}
                </footer>
              </section>
            );
          })}
        </div>
      </section>

      {usdcFaucets.length > 0 && (
        <Callout
          title="Need testnet tokens for your vault?"
          action={
            <div className="flex flex-wrap items-center gap-3">
              {usdcFaucets.map((token) => (
                <ExternalLink key={token.linkLabel} href={token.faucet}>
                  {token.linkLabel}
                </ExternalLink>
              ))}
            </div>
          }
        >
          <p>
            Native gas and credit faucets are linked on each network lane above. Use Circle&apos;s
            faucet for test USDC on your vault network.
          </p>
        </Callout>
      )}

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
              Runway estimates assume typical gas usage (~200k gas per trigger check and ~350k gas
              per settlement callback), plus the network billing surcharge and multiplier. A
              workflow proof can show actual execution gas from transaction receipts. Settlement
              transactions can also incur data fees.
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
