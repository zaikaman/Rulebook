import {
  agentAbi,
  amountIssue,
  getTemplate,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  vaultAbi,
  type Address,
  type Listing,
} from '@rulebook/shared';
import { useMutation, useQueries, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { parseUnits } from 'viem';
import { useAccount } from 'wagmi';

import { useRuleControl } from '../hooks/useRuleControl.js';
import { useSetupWallet } from '../hooks/useSetupWallet.js';
import { Spinner } from './chrome/Spinner.js';
import { api } from '../lib/api.js';
import { RuleFundingError } from '../lib/ruleFunding.js';
import { appRoutes } from '../lib/routes.js';
import { knownToken } from '../lib/signatures.js';
import { lasnaPublicClient, unichainPublicClient } from '../lib/wagmi.js';
import { Field } from '../ui/index.js';

import { ErrorState } from './ErrorState.js';

function listingKey(listing: Listing): string {
  return `${listing.agent}/${listing.rule_id}`;
}

/** Selects a public swap and authorizes the replay limits on the follower's Agent. */
export function MirrorForm({ listings }: { readonly listings: readonly Listing[] }) {
  const { address } = useAccount();
  const wallet = useSetupWallet();
  const [selected, setSelected] = useState('');
  const [scale, setScale] = useState('5000');
  const [cap, setCap] = useState('');
  const [hourly, setHourly] = useState('1');
  const owner = address?.toLowerCase() as Address | undefined;
  const follower = useQuery({
    queryKey: ['mirror-account', owner],
    enabled: Boolean(owner),
    queryFn: async () => {
      if (!owner) return null;
      const agent = await wallet.getAgent(owner);
      const vault = await wallet.getVault(owner);
      if (!agent || !vault) return null;
      const [mode, tokenIn, tokenOut, linked, boundAgent] = await Promise.all([
        unichainPublicClient.readContract({
          address: vault,
          abi: vaultAbi,
          functionName: 'mirrorMode',
        }),
        unichainPublicClient.readContract({
          address: vault,
          abi: vaultAbi,
          functionName: 'allowedTokenIn',
        }),
        unichainPublicClient.readContract({
          address: vault,
          abi: vaultAbi,
          functionName: 'allowedTokenOut',
        }),
        lasnaPublicClient.readContract({
          address: agent,
          abi: agentAbi,
          functionName: 'getVault',
          args: [BigInt(UNICHAIN_SEPOLIA_CHAIN_ID)],
        }),
        unichainPublicClient.readContract({ address: vault, abi: vaultAbi, functionName: 'agent' }),
      ]);
      return {
        agent,
        mode,
        tokenIn,
        tokenOut,
        linked:
          linked.toLowerCase() === vault.toLowerCase() &&
          boundAgent.toLowerCase() === agent.toLowerCase(),
      };
    },
  });
  const currentAccount = follower.data;
  const compatible = Boolean(currentAccount?.mode && currentAccount.linked);
  const candidates = compatible
    ? listings.filter(
        (listing) => listing.author !== owner && listing.template >= 1 && listing.template <= 6,
      )
    : [];
  const sources = useQueries({
    queries: candidates.map((listing) => ({
      queryKey: ['rule', listing.agent, listing.rule_id.toString()],
      queryFn: () => api.ruleDetail(listing.agent, listing.rule_id.toString()),
    })),
  });
  const options = candidates.flatMap((listing, index) => {
    const detail = sources[index]?.data;
    if (
      !currentAccount ||
      !detail?.mirror_source ||
      detail.rule.token_in?.toLowerCase() !== currentAccount.tokenIn.toLowerCase() ||
      detail.rule.token_out?.toLowerCase() !== currentAccount.tokenOut.toLowerCase()
    )
      return [];
    return [{ listing, vault: detail.mirror_source, tokenIn: currentAccount.tokenIn }];
  });
  const source = options.find(({ listing }) => listingKey(listing) === selected);
  const token = knownToken(UNICHAIN_SEPOLIA_CHAIN_ID, currentAccount?.tokenIn);
  const capError = cap.trim()
    ? amountIssue(cap, {
        subject: 'The per-run cap',
        noun: 'a per-run cap',
        decimals: token?.decimals ?? 0,
        unit: token?.symbol,
        minimum: 1n,
      })
    : undefined;
  const scaleError =
    scale.trim() && (!/^\d+$/.test(scale.trim()) || Number(scale) < 1 || Number(scale) > 10_000)
      ? 'Enter a whole number of basis points from 1 to 10,000.'
      : undefined;
  const hourlyError =
    hourly.trim() && (!/^\d+$/.test(hourly.trim()) || Number(hourly) < 1 || Number(hourly) > 10)
      ? 'Enter a whole number of trades per hour from 1 to 10.'
      : undefined;
  const control = useRuleControl(currentAccount?.agent ?? null);
  const mutation = useMutation({
    mutationFn: async () => {
      if (!source || !currentAccount || !compatible)
        throw new Error('Select an eligible leader rule.');
      const decimals = knownToken(UNICHAIN_SEPOLIA_CHAIN_ID, source.tokenIn)?.decimals ?? 0;
      if (!cap.trim()) throw new Error('Enter a per-run cap.');
      if (capError) throw new Error(capError);
      if (!scale.trim()) throw new Error('Enter a scale in basis points.');
      if (scaleError) throw new Error(scaleError);
      if (!hourly.trim()) throw new Error('Enter the maximum trades per hour.');
      if (hourlyError) throw new Error(hourlyError);
      const perRunCap = parseUnits(cap.trim(), decimals);
      const scaleBps = Number(scale);
      const hourlyCap = Number(hourly);
      const ruleId = await lasnaPublicClient.readContract({
        address: currentAccount.agent,
        abi: agentAbi,
        functionName: 'nextRuleId',
      });
      await control.attachMirror(ruleId, {
        leaderChainId: BigInt(UNICHAIN_SEPOLIA_CHAIN_ID),
        leaderVault: source.vault,
        leaderRuleId: source.listing.rule_id,
        leaderAgent: source.listing.agent,
        tokenIn: source.tokenIn,
        scaleBps,
        hourlyCap,
        perRunCap,
      });
      return { agent: currentAccount.agent, ruleId };
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate();
  }

  return (
    <section className="app-panel app-panel-pad space-y-3">
      <h2 className="app-panel-heading">Mirror a trade</h2>
      {!owner ? <p className="app-copy">Connect the wallet that owns your mirror vault.</p> : null}
      {owner && follower.isPending ? (
        <p role="status" className="rb-loading">
          <Spinner />
          Checking your vault…
        </p>
      ) : null}
      {follower.error ? (
        <ErrorState message="Your vault could not be verified." detail={follower.error.message} />
      ) : null}
      {owner && follower.isSuccess && !compatible ? (
        <p className="app-copy">
          Mirroring requires a linked mirror-only vault.{' '}
          {!currentAccount || currentAccount.mode ? (
            <Link to="/account" className="app-link">
              Open account setup
            </Link>
          ) : null}
          {currentAccount && !currentAccount.mode
            ? 'This wallet has a standard vault with a permanent mode.'
            : null}
        </p>
      ) : null}
      {compatible ? (
        <form onSubmit={submit} className="grid gap-3">
          <label className="app-field">
            Leader rule
            <select
              required
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
              className="app-input"
            >
              <option value="">Choose a matching public swap</option>
              {options.map(({ listing }) => (
                <option key={listingKey(listing)} value={listingKey(listing)}>
                  {listing.name ?? getTemplate(listing.template)?.name ?? 'Swap'} · #
                  {listing.rule_id.toString()} · {listing.author.slice(0, 10)}
                </option>
              ))}
            </select>
          </label>
          {options.length === 0 ? (
            <p className="app-copy rb-loading" role="status">
              {sources.some((query) => query.isPending) && <Spinner />}
              {sources.some((query) => query.isPending)
                ? 'Checking public swaps…'
                : 'No matching leader swaps are shown.'}
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-3">
            <Field
              label="Scale (bps)"
              hint="1 to 10,000 basis points of the leader size. 5,000 mirrors at half size."
              error={scaleError}
            >
              {(ids) => (
                <input
                  className="app-input"
                  type="number"
                  required
                  min={1}
                  max={10_000}
                  value={scale}
                  onChange={(event) => setScale(event.target.value)}
                  aria-invalid={Boolean(scaleError) || undefined}
                  aria-describedby={ids.error ?? ids.hint}
                />
              )}
            </Field>
            <Field
              label={`Per-run cap (${token?.symbol ?? 'base units'})`}
              hint="The most one mirrored trade may spend."
              error={capError}
            >
              {(ids) => (
                <input
                  className="app-input"
                  required
                  inputMode="decimal"
                  value={cap}
                  onChange={(event) => setCap(event.target.value)}
                  placeholder="0.00"
                  aria-invalid={Boolean(capError) || undefined}
                  aria-describedby={ids.error ?? ids.hint}
                />
              )}
            </Field>
            <Field
              label="Trades per hour"
              hint="From 1 to 10 mirrored trades each hour."
              error={hourlyError}
            >
              {(ids) => (
                <input
                  className="app-input"
                  type="number"
                  required
                  min={1}
                  max={10}
                  value={hourly}
                  onChange={(event) => setHourly(event.target.value)}
                  aria-invalid={Boolean(hourlyError) || undefined}
                  aria-describedby={ids.error ?? ids.hint}
                />
              )}
            </Field>
          </div>
          <p className="app-alert" data-tone="warning">
            Thin pools can move between trades. Your mirror skips the swap if its live quote falls
            below the minimum output.
          </p>
          <div>
            <button
              type="submit"
              className="app-button app-button--primary"
              disabled={
                !source ||
                mutation.isPending ||
                Boolean(scaleError) ||
                Boolean(capError) ||
                Boolean(hourlyError)
              }
            >
              {mutation.isPending && <Spinner />}
              {mutation.isPending ? 'Waiting for confirmation…' : 'Attach mirror'}
            </button>
          </div>
          {mutation.error ? (
            <ErrorState
              message="The mirror could not be attached."
              detail={mutation.error.message}
              chainId={LASNA_CHAIN_ID}
            >
              {mutation.error instanceof RuleFundingError && mutation.error.needsDeposit && (
                <Link
                  to={appRoutes.account}
                  target="_blank"
                  rel="noreferrer"
                  className="app-link mt-3 block"
                >
                  Fund your vault (opens in a new tab)
                </Link>
              )}
            </ErrorState>
          ) : null}
          {mutation.data ? (
            <p role="status" className="app-copy">
              Mirror attached.{' '}
              <Link
                className="app-link"
                to={`/rules/${mutation.data.agent}/${mutation.data.ruleId}`}
              >
                View follower rule
              </Link>
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}

/** Requests the owner signature that permanently detaches a follower rule. */
export function DetachMirror({ detach }: { readonly detach: () => Promise<void> }) {
  const mutation = useMutation({ mutationFn: detach });
  return (
    <div className="space-y-2">
      <button
        type="button"
        className="app-button"
        disabled={mutation.isPending || mutation.isSuccess}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending && <Spinner />}
        {mutation.isPending ? 'Waiting for confirmation…' : 'Detach mirror'}
      </button>
      {mutation.isSuccess ? (
        <p role="status" className="app-copy">
          Mirror detached.
        </p>
      ) : null}
      {mutation.error ? (
        <ErrorState
          message="The mirror could not be detached."
          detail={mutation.error.message}
          chainId={LASNA_CHAIN_ID}
        />
      ) : null}
    </div>
  );
}
