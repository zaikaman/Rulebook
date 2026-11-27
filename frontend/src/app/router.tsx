import { fundsChainIdSchema } from '@rulebook/shared';
import { Suspense, lazy, useEffect, useRef, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useSearchParams } from 'react-router';

import { AppShell } from '../components/AppShell.js';
import { LoadingRegion, PanelSkeleton } from '../components/chrome/Skeleton.js';
import { OfflineState } from '../components/OfflineState.js';
import {
  buildNetworkModeState,
  getUrlNetworkMode,
  useNetworkMode,
  withNetworkQuery,
} from '../lib/networkMode.js';
import { appRoutes, setupHref } from '../lib/routes.js';
import { LandingPage } from '../pages/LandingPage.js';
import { ErrorBoundary } from './ErrorBoundary.js';
import '../styles/workflows.css';
import '../styles/app.css';

// The landing page is the entry route, so it ships in the initial bundle. Every workspace
// route is fetched on demand the first time it is opened and cached after that, which keeps
// the first paint free of builder, marketplace, proof, and account code. The page modules use
// named exports, so each lazy component picks its own export out of the module namespace.
const WorkflowBuilderV2 = lazy(async () => ({
  default: (await import('../workflows/BuilderV2.js')).WorkflowBuilderV2,
}));
const WorkflowEditRouteV2 = lazy(async () => ({
  default: (await import('../workflows/BuilderV2.js')).WorkflowEditRouteV2,
}));
const WorkflowProof = lazy(async () => ({
  default: (await import('../workflows/WorkflowProof.js')).WorkflowProof,
}));
const WorkflowProofLookup = lazy(async () => ({
  default: (await import('../workflows/WorkflowProof.js')).WorkflowProofLookup,
}));
const WorkflowCost = lazy(async () => ({
  default: (await import('../workflows/WorkflowCost.js')).WorkflowCost,
}));
const WorkflowsRouteV2 = lazy(async () => ({
  default: (await import('../workflows/WorkspaceV2.js')).WorkflowsRouteV2,
}));
const WorkflowDetailRouteV2 = lazy(async () => ({
  default: (await import('../workflows/WorkspaceV2.js')).WorkflowDetailRouteV2,
}));
const WorkflowActivityRouteV2 = lazy(async () => ({
  default: (await import('../workflows/WorkspaceV2.js')).WorkflowActivityRouteV2,
}));
const WorkflowSetupRouteV2 = lazy(async () => ({
  default: (await import('../workflows/WorkspaceV2.js')).WorkflowSetupRouteV2,
}));
const WorkflowAccountGuardedRoute = lazy(async () => ({
  default: (await import('../workflows/WorkspaceV2.js')).WorkflowAccountGuardedRoute,
}));
const WorkflowAccountV2 = lazy(async () => ({
  default: (await import('../workflows/WorkspaceV2.js')).WorkflowAccountV2,
}));
const WorkflowMarketplaceV2 = lazy(async () => ({
  default: (await import('../workflows/MarketplaceV2.js')).WorkflowMarketplaceV2,
}));
const WorkflowListingV2 = lazy(async () => ({
  default: (await import('../workflows/MarketplaceV2.js')).WorkflowListingV2,
}));

/** Placeholder shaped like the panels the route is about to render. */
function RouteFallback() {
  return (
    <LoadingRegion label="Loading this page">
      <PanelSkeleton rows={4} />
    </LoadingRegion>
  );
}

/** Holds the current screen while a route chunk downloads, so the shell never flashes away. */
function PageBoundary({ children }: { readonly children: ReactNode }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>;
}

function WorkspaceLayout() {
  return (
    <AppShell>
      <PageBoundary>
        <Outlet />
      </PageBoundary>
    </AppShell>
  );
}

function WorkflowAccountFundsRoute() {
  const { mode } = useNetworkMode();
  return <WorkflowAccountV2 key={mode} manage />;
}

function CreateRouteRedirect() {
  const { mode } = useNetworkMode();
  const [params] = useSearchParams();
  const effectiveMode = getUrlNetworkMode(`?${params.toString()}`) ?? mode;
  const effectiveChains = buildNetworkModeState(effectiveMode).configuredFundsChains;
  const parsedChain = fundsChainIdSchema.safeParse(Number(params.get('chain')));
  const chain =
    parsedChain.success && effectiveChains.includes(parsedChain.data)
      ? parsedChain.data
      : undefined;
  return (
    <Navigate to={setupHref({ next: appRoutes.newWorkflow, chain, mode: effectiveMode })} replace />
  );
}

function NetworkNavigate({ to }: { readonly to: string }) {
  const { mode } = useNetworkMode();
  return <Navigate to={withNetworkQuery(to, mode)} replace />;
}

export function NetworkModeQuerySync() {
  const { mode, setMode } = useNetworkMode();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlMode = getUrlNetworkMode(`?${searchParams.toString()}`);
  const prevModeRef = useRef(mode);
  const prevUrlModeRef = useRef(urlMode);

  useEffect(() => {
    const modeChanged = prevModeRef.current !== mode;
    const urlChanged = prevUrlModeRef.current !== urlMode;
    prevModeRef.current = mode;
    prevUrlModeRef.current = urlMode;

    if (urlChanged && urlMode && urlMode !== mode) {
      setMode(urlMode, { persist: false });
      return;
    }
    if (modeChanged) {
      const next = new URLSearchParams(searchParams);
      if (mode === 'mainnet') next.set('network', 'mainnet');
      else next.delete('network');
      if (next.toString() !== searchParams.toString()) {
        setSearchParams(next, { replace: true });
      }
      return;
    }
    if (urlMode && urlMode !== mode) {
      setMode(urlMode, { persist: false });
    }
  }, [mode, searchParams, setMode, setSearchParams, urlMode]);

  return null;
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <NetworkModeQuerySync />
      <ErrorBoundary>
        <Routes>
          <Route
            path="/"
            element={
              <>
                <OfflineState />
                <LandingPage />
              </>
            }
          />

          <Route
            path="setup"
            element={
              <PageBoundary>
                <WorkflowSetupRouteV2 />
              </PageBoundary>
            }
          />
          <Route path="create" element={<CreateRouteRedirect />} />
          <Route element={<WorkspaceLayout />}>
            <Route path="account" element={<WorkflowAccountGuardedRoute />} />
            <Route path="account/funds" element={<WorkflowAccountFundsRoute />} />
            <Route path="workflows" element={<WorkflowsRouteV2 />} />
            <Route path="workflows/new" element={<WorkflowBuilderV2 />} />
            <Route path="workflows/:id" element={<WorkflowDetailRouteV2 />} />
            <Route path="workflows/:id/edit" element={<WorkflowEditRouteV2 />} />
            <Route path="activity" element={<WorkflowActivityRouteV2 />} />
            <Route path="runs/:id" element={<WorkflowProof />} />
            <Route path="rules" element={<NetworkNavigate to="/workflows" />} />
            <Route path="rules/:agent/:ruleId" element={<NetworkNavigate to="/workflows" />} />
            <Route path="proof" element={<WorkflowProofLookup />} />
            <Route path="proof/:reactiveTxHash" element={<NetworkNavigate to="/proof" />} />
            <Route path="marketplace" element={<WorkflowMarketplaceV2 />} />
            <Route path="marketplace/:listingId" element={<WorkflowListingV2 />} />
            <Route path="leaderboard" element={<NetworkNavigate to="/marketplace" />} />
            <Route path="cost" element={<WorkflowCost />} />
            <Route path="*" element={<NetworkNavigate to="/workflows" />} />
          </Route>
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
