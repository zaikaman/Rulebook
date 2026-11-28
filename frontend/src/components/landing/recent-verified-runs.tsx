import { ArrowRight02Icon, Clock01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  automationChainFor,
  CHAIN_CONFIGS,
  networkModeForChain,
  REACTIVE_MAINNET_CHAIN_ID,
} from '@rulebook/shared';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { zeroHash } from 'viem';

import { useNetworkMode, withNetworkQuery } from '@/lib/networkMode.js';
import { appRoutes } from '@/lib/routes.js';
import {
  computeProofLatency,
  proofStageTelemetryQuery,
  shortHex,
} from '@/workflows/proofTiming.js';
import { recentVerifiedRunsQuery } from '@/workflows/recentRuns.js';

function shortChainLabel(chainId: number): string {
  if (chainId <= 0) return 'Schedule';
  const name = CHAIN_CONFIGS.get(chainId)?.name;
  if (!name) return `Chain ${chainId}`;
  return name.replace(/^Reactive /, '');
}

export function RecentVerifiedRuns() {
  const { mode, isMainnet, isDeploymentConfigured } = useNetworkMode();
  const recentRuns = useQuery(
    recentVerifiedRunsQuery(mode, 3, !isMainnet && isDeploymentConfigured),
  );
  const runs = recentRuns.data ?? [];

  const telemetryQueries = useQueries({
    queries: runs.flatMap((run) => {
      const runMode = networkModeForChain(run.chain);
      const automationChain = automationChainFor(runMode);
      const hasOriginTx = Boolean(run.originTransaction && run.originTransaction !== zeroHash);
      return [
        proofStageTelemetryQuery(
          hasOriginTx && run.originChain > 0 ? run.originChain : 0,
          hasOriginTx ? run.originTransaction : null,
        ),
        proofStageTelemetryQuery(automationChain, run.lasnaTransaction),
        proofStageTelemetryQuery(run.chain, run.destinationTransaction),
      ];
    }),
  });

  if (isMainnet) return null;

  return (
    <div className="mt-12 rounded-3xl border border-white/10 bg-white/[0.02] p-6 sm:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-xl font-medium tracking-tight text-white">Recent verified runs</h3>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-neutral-400">
            Inspect real testnet demo runs with no wallet connected. Follow the trigger, Reactive
            decision, and vault settlement with block-level timing.
          </p>
        </div>
        <Link
          to={withNetworkQuery(appRoutes.proof, mode, true)}
          className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-blue-200 underline underline-offset-4 hover:text-white"
        >
          Open proof lookup
          <HugeiconsIcon icon={ArrowRight02Icon} size={15} aria-hidden="true" />
        </Link>
      </div>

      {isDeploymentConfigured && recentRuns.isPending ? (
        <div
          className="mt-6 grid gap-4 md:grid-cols-3"
          aria-busy="true"
          aria-label="Loading recent verified runs"
        >
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="h-40 animate-pulse rounded-2xl border border-white/10 bg-white/[0.03] p-5"
            />
          ))}
        </div>
      ) : runs.length > 0 ? (
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {runs.map((run, index) => {
            const runMode = networkModeForChain(run.chain);
            const automationChain = automationChainFor(runMode);
            const hasOriginTx = Boolean(
              run.originTransaction && run.originTransaction !== zeroHash,
            );
            const originTelemetry = telemetryQueries[index * 3];
            const decisionTelemetry = telemetryQueries[index * 3 + 1];
            const settlementTelemetry = telemetryQueries[index * 3 + 2];
            const decisionShortName =
              automationChain === REACTIVE_MAINNET_CHAIN_ID ? 'Reactive Mainnet' : 'Lasna';
            const latency = computeProofLatency({
              originTimestamp: originTelemetry?.data?.timestamp ?? null,
              decisionTimestamp: decisionTelemetry?.data?.timestamp ?? null,
              settlementTimestamp: settlementTelemetry?.data?.timestamp ?? null,
              hasOriginTx,
              hasSettlementTx: Boolean(
                run.destinationTransaction && run.destinationTransaction !== zeroHash,
              ),
              decisionShortName,
            });
            const hopSummary = latency.hops
              .filter((hop) => hop.seconds !== null)
              .map((hop) => `${hop.label} ${hop.formatted}`)
              .join(' · ');

            return (
              <Link
                key={`${run.chain}:${run.id}`}
                to={withNetworkQuery(`${appRoutes.runs}/${run.id}`, runMode, true)}
                className="group flex flex-col justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-blue-400/40 hover:bg-white/[0.05] focus-visible:rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="text-xs font-medium text-neutral-300">
                    {shortChainLabel(run.originChain)} -&gt; {shortChainLabel(automationChain)}{' '}
                    -&gt; {shortChainLabel(run.chain)}
                  </span>
                  <span className="shrink-0 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300">
                    Confirmed
                  </span>
                </div>

                <div>
                  <div className="flex items-center gap-2 text-lg font-medium text-white">
                    <HugeiconsIcon
                      icon={Clock01Icon}
                      size={16}
                      aria-hidden="true"
                      className="shrink-0 text-blue-300"
                    />
                    <span className="font-mono tabular-nums">
                      {latency.formattedTotal
                        ? `${latency.formattedTotal} total`
                        : 'On-chain proof'}
                    </span>
                  </div>
                  <p className="mt-1.5 font-mono text-xs tabular-nums text-neutral-400">
                    {hopSummary || 'See transaction details'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3 text-xs">
                  <span className="flex min-w-0 items-center gap-2 text-neutral-400">
                    {run.path !== null ? (
                      <span className="whitespace-nowrap">Path {run.path + 1}</span>
                    ) : null}
                    <code className="truncate font-mono text-neutral-300">{shortHex(run.id)}</code>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-medium text-blue-200 transition-colors group-hover:text-white">
                    Inspect proof
                    <HugeiconsIcon
                      icon={ArrowRight02Icon}
                      size={13}
                      aria-hidden="true"
                      className="transition-transform group-hover:translate-x-0.5"
                    />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.02] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-neutral-400">
            {recentRuns.isError
              ? 'Recent verified runs could not be loaded.'
              : 'No settled runs from the public testnet demo are available yet.'}
          </p>
          <Link
            to={withNetworkQuery(appRoutes.proof, mode, true)}
            className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-blue-200 underline underline-offset-4 hover:text-white"
          >
            Look up a run by ID
            <HugeiconsIcon icon={ArrowRight02Icon} size={14} aria-hidden="true" />
          </Link>
        </div>
      )}
    </div>
  );
}
