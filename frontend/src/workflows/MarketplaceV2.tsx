import {
  decodeWorkflowV2,
  fundsChainsFor,
  getChain,
  workflowV2Trigger as T,
  type TriggerCode,
} from '@rulebook/shared';
import {
  ArrowRight01Icon,
  Clock01Icon,
  Coins01Icon,
  Exchange01Icon,
  Search01Icon,
  Store01Icon,
  Tick02Icon,
  TradeUpIcon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { Link, useParams } from 'react-router';

import { CopyButton } from '@/components/chrome/CopyButton';
import { EmptyState } from '@/components/chrome/EmptyState';
import { PageHeading } from '@/components/chrome/PageHeading';
import { CardGridSkeleton, LoadingRegion } from '@/components/chrome/Skeleton';
import { Spinner } from '@/components/chrome/Spinner';
import { MainnetUnavailableCallout } from '@/components/MainnetUnavailableCallout';
import { NetworkBadge } from '@/components/NetworkBadge';
import { useNetworkMode, withNetworkQuery } from '@/lib/networkMode';
import {
  Badge,
  Button,
  CardGrid,
  ErrorState,
  FactList,
  FilterBar,
  FilterGroup,
  LinkCard,
  Panel,
  PanelBody,
  PanelCopy,
  PanelHeader,
  PanelHeading,
  PanelTitle,
  Toolbar,
} from '@/ui';
import { WorkflowProgramSummary } from './BuilderV2';
import {
  type MarketplaceScopeFilter,
  type MarketplaceTriggerFilter,
  type V2MarketListing,
  type V2MarketPage,
  v2ApiBase,
  v2ListingId,
  v2ListingQuery,
  v2MarketPage,
} from './listingV2';
import { ListingStatusV2 } from './ListingStatusV2';
import { toDraft, triggers } from './modelV2';

type IconProp = ComponentProps<typeof HugeiconsIcon>['icon'];

const triggerIcons: Record<TriggerCode, IconProp> = {
  [T.schedule]: Clock01Icon,
  [T.payment]: Coins01Icon,
  [T.price]: TradeUpIcon,
  [T.transfer]: Exchange01Icon,
};

const triggerOptions: ReadonlyArray<{ value: 'all' | MarketplaceTriggerFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'schedule', label: 'Schedule' },
  { value: 'payment', label: 'USDC payment' },
  { value: 'price', label: 'Pool price' },
  { value: 'transfer', label: 'Token transfer' },
];

const scopeOptions: ReadonlyArray<{ value: MarketplaceScopeFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'single', label: 'Single-chain' },
  { value: 'cross', label: 'Cross-chain' },
];

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function readListingMeta(item: V2MarketListing): {
  originChain: number;
  trigger: TriggerCode | null;
} {
  if (item.origin_chain !== undefined && item.trigger !== undefined) {
    return { originChain: item.origin_chain, trigger: item.trigger };
  }
  try {
    const decoded = decodeWorkflowV2(item.program);
    return {
      originChain: item.origin_chain ?? decoded.originChain,
      trigger: item.trigger ?? (decoded.trigger as TriggerCode),
    };
  } catch {
    return {
      originChain: item.origin_chain ?? item.chain,
      trigger: item.trigger ?? null,
    };
  }
}

function VerifiedRunsBadge({ count }: { readonly count: number }) {
  const label = `${count} verified ${count === 1 ? 'run' : 'runs'}`;
  if (count > 0) {
    return (
      <Badge tone="active" plain>
        <HugeiconsIcon icon={Tick02Icon} size={12} strokeWidth={2.1} aria-hidden="true" />
        <span>{label}</span>
      </Badge>
    );
  }
  return <Badge plain>{label}</Badge>;
}

export function WorkflowMarketplaceV2() {
  const { mode, isMainnet, isDeploymentConfigured } = useNetworkMode();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [chainFilter, setChainFilter] = useState<string>('all');
  const [scopeFilter, setScopeFilter] = useState<MarketplaceScopeFilter>('all');
  const [triggerFilter, setTriggerFilter] = useState<'all' | MarketplaceTriggerFilter>('all');

  useEffect(() => {
    const trimmed = search.trim();
    if (!trimmed) {
      setDebouncedSearch('');
      return;
    }
    const timer = setTimeout(() => setDebouncedSearch(trimmed), 200);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setChainFilter('all');
  }, [mode]);

  const availableChains = fundsChainsFor(mode);
  const effectiveChain =
    chainFilter !== 'all' && availableChains.some((id) => String(id) === chainFilter)
      ? chainFilter
      : 'all';

  const networkOptions = useMemo(
    () => [
      { value: 'all', label: 'All' },
      ...availableChains.map((id) => ({ value: String(id), label: getChain(id).name })),
    ],
    [availableChains],
  );

  const query = useInfiniteQuery<V2MarketPage>({
    queryKey: [
      'workflow-v2',
      'marketplace',
      mode,
      debouncedSearch,
      effectiveChain,
      scopeFilter,
      triggerFilter,
    ],
    enabled: isDeploymentConfigured,
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[2] === mode ? previousData : undefined,
    refetchOnMount: 'always',
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({
        q: debouncedSearch,
        network: mode,
        ...(effectiveChain !== 'all' ? { chain: effectiveChain } : {}),
        ...(scopeFilter !== 'all'
          ? { crossChain: scopeFilter === 'cross' ? 'true' : 'false' }
          : {}),
        ...(triggerFilter !== 'all' ? { trigger: triggerFilter } : {}),
        ...(pageParam ? { after: String(pageParam) } : {}),
      });
      const response = await fetch(`${v2ApiBase}/v3/marketplace?${params}`, { signal });
      if (!response.ok) throw new Error('The Marketplace could not load.');
      return v2MarketPage.parse(await response.json());
    },
    getNextPageParam: (result) => result.nextCursor,
  });

  const items = query.data?.pages.flatMap((result) => result.listings) ?? [];
  const hasFilters =
    search.trim().length > 0 ||
    effectiveChain !== 'all' ||
    scopeFilter !== 'all' ||
    triggerFilter !== 'all';

  function resetFilters() {
    setSearch('');
    setDebouncedSearch('');
    setChainFilter('all');
    setScopeFilter('all');
    setTriggerFilter('all');
  }

  return (
    <section className="app-page">
      <PageHeading
        title="Marketplace"
        description={
          isMainnet
            ? 'Find a mainnet automation for your wallet. Preview its logic and copy it as a private draft.'
            : 'Explore testnet workflows for payments, wallet alerts, and trading. Preview the logic and copy a workflow as a private draft.'
        }
        aside={
          query.isSuccess && (
            <Badge plain aria-live="polite">
              {items.length}
              {query.hasNextPage ? '+' : ''} listed
            </Badge>
          )
        }
      />

      {!isDeploymentConfigured &&
        (isMainnet ? (
          <MainnetUnavailableCallout context="Marketplace" />
        ) : (
          <p className="rb-note">
            The Marketplace opens when the testnet deployment is configured.
          </p>
        ))}

      <FilterBar
        toolbar={
          <Toolbar>
            <label className="rb-search">
              <span className="sr-only">Search listings</span>
              <HugeiconsIcon icon={Search01Icon} size={16} aria-hidden="true" />
              <input
                className="app-input"
                type="search"
                maxLength={160}
                value={search}
                disabled={!isDeploymentConfigured}
                placeholder="Search by name or description"
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            {hasFilters && isDeploymentConfigured && (
              <Button variant="quiet" onClick={resetFilters}>
                Reset filters
              </Button>
            )}
          </Toolbar>
        }
      >
        <FilterGroup
          label="Network"
          options={networkOptions}
          value={effectiveChain}
          defaultValue="all"
          onChange={setChainFilter}
          disabled={!isDeploymentConfigured}
        />
        <FilterGroup
          label="Routing"
          options={scopeOptions}
          value={scopeFilter}
          defaultValue="all"
          onChange={setScopeFilter}
          disabled={!isDeploymentConfigured}
        />
        <FilterGroup
          label="Trigger"
          options={triggerOptions}
          value={triggerFilter}
          defaultValue="all"
          onChange={setTriggerFilter}
          disabled={!isDeploymentConfigured}
        />
      </FilterBar>

      {query.error && (
        <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />
      )}

      {(query.isPending || (query.isPlaceholderData && !items.length && !query.error)) &&
        isDeploymentConfigured && (
          <LoadingRegion label="Loading Marketplace…">
            <CardGridSkeleton count={3} />
          </LoadingRegion>
        )}

      {query.isSuccess && !query.isPlaceholderData && !items.length && (
        <EmptyState
          icon={hasFilters ? Search01Icon : Store01Icon}
          title={hasFilters ? 'No listings match your filters' : 'Nothing published yet'}
          description={
            hasFilters
              ? 'Try a different keyword or reset the active filters to browse every published workflow.'
              : 'Published workflows become starting points for other wallets. Publish one from its detail page to list it here.'
          }
          action={
            hasFilters ? (
              <Button onClick={resetFilters}>Reset filters</Button>
            ) : (
              <Link
                className="app-button app-button--primary"
                to={withNetworkQuery('/workflows/new', mode)}
              >
                Build a workflow
              </Link>
            )
          }
        />
      )}

      {!query.error && !!items.length && (
        <CardGrid compact aria-busy={query.isFetching && !query.isPending}>
          {items.map((item) => {
            const meta = readListingMeta(item);
            const crossChain = meta.originChain !== item.chain;
            const triggerLabel = meta.trigger ? triggers[meta.trigger] : null;
            const icon = meta.trigger ? triggerIcons[meta.trigger] : Store01Icon;
            return (
              <li key={item.id}>
                <LinkCard
                  to={withNetworkQuery(`/marketplace/${item.id}`, mode)}
                  title={item.title}
                  icon={<HugeiconsIcon icon={icon} size={18} strokeWidth={1.7} />}
                  iconTone={meta.trigger === T.payment ? 'funds' : 'automation'}
                  meta={triggerLabel}
                  description={item.description}
                  footer={
                    <div className="flex min-w-0 flex-wrap items-center gap-1">
                      {crossChain && (
                        <>
                          <span className="sr-only">Watches</span>
                          <NetworkBadge chainId={meta.originChain} />
                          <HugeiconsIcon icon={ArrowRight01Icon} size={12} aria-hidden="true" />
                          <span className="sr-only">Settles on</span>
                        </>
                      )}
                      <NetworkBadge chainId={item.chain} />
                    </div>
                  }
                  cue="Preview"
                >
                  <VerifiedRunsBadge count={item.verified_runs} />
                  {crossChain && (
                    <Badge tone="info" plain>
                      Cross-chain
                    </Badge>
                  )}
                </LinkCard>
              </li>
            );
          })}
        </CardGrid>
      )}

      {!query.error && query.hasNextPage && (
        <Button
          disabled={query.isFetchingNextPage || query.isPlaceholderData}
          onClick={() => {
            if (!query.isPlaceholderData) void query.fetchNextPage();
          }}
        >
          {query.isFetchingNextPage && <Spinner />}
          {query.isFetchingNextPage ? 'Loading more listings' : 'Load more listings'}
        </Button>
      )}
    </section>
  );
}

export function WorkflowListingV2() {
  const { mode } = useNetworkMode();
  const { listingId } = useParams();
  const id = v2ListingId.safeParse(listingId);
  const query = useQuery(v2ListingQuery(id.data, mode));
  if (!id.success) return <p role="alert">This listing link is invalid.</p>;
  if (!query.isFetchedAfterMount || !query.data || query.error || query.failureReason)
    return <ListingStatusV2 query={query} />;
  const item = query.data;
  const draft = toDraft(decodeWorkflowV2(item.program), item.title);
  const crossChain = draft.originChain !== item.chain;

  return (
    <section className="app-page">
      <PageHeading
        eyebrow="Marketplace"
        title={item.title}
        description={item.description}
        aside={
          <Link
            className="app-button app-button--primary"
            to={withNetworkQuery(`/workflows/new?copy=${item.id}`, mode)}
          >
            Copy as draft
          </Link>
        }
      />
      <div className="rb-split">
        <Panel>
          <PanelHeader>
            <PanelHeading
              title="Program"
              description="The published trigger, checks, and actions."
            />
          </PanelHeader>
          <PanelBody>
            <WorkflowProgramSummary draft={draft} />
          </PanelBody>
        </Panel>
        <Panel className="rb-listing-details">
          <PanelHeader>
            <div className="rb-listing-details-heading">
              <span className="rb-listing-details-mark" aria-hidden="true">
                <HugeiconsIcon icon={Store01Icon} size={18} strokeWidth={1.7} />
              </span>
              <div>
                <PanelTitle>Listing details</PanelTitle>
                <PanelCopy>
                  {mode === 'mainnet'
                    ? 'Published on the Mainnet Marketplace.'
                    : 'Published on the testnet Marketplace.'}
                </PanelCopy>
              </div>
            </div>
          </PanelHeader>
          <PanelBody>
            <FactList
              className="rb-listing-facts"
              items={[
                {
                  term: 'Published by',
                  valueClassName: 'rb-listing-address',
                  value: (
                    <>
                      <code title={item.owner}>{shortAddress(item.owner)}</code>
                      <CopyButton value={item.owner} label="publisher address" />
                    </>
                  ),
                },
                { term: 'Listing', valueClassName: 'rb-listing-id', value: `#${item.id}` },
                { term: 'Verified runs', value: <VerifiedRunsBadge count={item.verified_runs} /> },
                { term: 'Trigger', value: triggers[draft.trigger] },
                { term: 'Settlement', value: <NetworkBadge chainId={item.chain} /> },
                ...(crossChain
                  ? [
                      { term: 'Watches', value: <NetworkBadge chainId={draft.originChain} /> },
                      {
                        term: 'Routing',
                        value: (
                          <Badge tone="info" plain>
                            Cross-chain
                          </Badge>
                        ),
                      },
                    ]
                  : []),
                { term: 'Visibility', value: <Badge tone="active">Public</Badge> },
              ]}
            />
            <p className="rb-listing-note">
              Copying creates a private draft in the builder. Review each node and the spending
              limits before activating it from your own vault.
            </p>
            <div className="rb-action-row">
              <CopyButton
                value={
                  new URL(
                    withNetworkQuery(`/marketplace/${item.id}`, mode, true),
                    window.location.origin,
                  ).href
                }
                label="listing link"
              />
              <Link className="app-button" to={withNetworkQuery('/marketplace', mode)}>
                Back to Marketplace
              </Link>
            </div>
          </PanelBody>
        </Panel>
      </div>
    </section>
  );
}
