import { Suspense, lazy, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router';

import { AppShell } from '../components/AppShell.js';
import { LoadingRegion, PanelSkeleton } from '../components/chrome/Skeleton.js';
import { OfflineState } from '../components/OfflineState.js';
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
const WorkflowProof = lazy(async () => ({
  default: (await import('../workflows/WorkflowProof.js')).WorkflowProof,
}));
const WorkflowProofLookup = lazy(async () => ({
  default: (await import('../workflows/WorkflowProof.js')).WorkflowProofLookup,
}));
const WorkflowCost = lazy(async () => ({
  default: (await import('../workflows/WorkflowCost.js')).WorkflowCost,
}));
const WorkflowsV2 = lazy(async () => ({
  default: (await import('../workflows/WorkspaceV2.js')).WorkflowsV2,
}));
const WorkflowDetailV2 = lazy(async () => ({
  default: (await import('../workflows/WorkspaceV2.js')).WorkflowDetailV2,
}));
const WorkflowActivityV2 = lazy(async () => ({
  default: (await import('../workflows/WorkspaceV2.js')).WorkflowActivityV2,
}));
const WorkflowAccountRouteV2 = lazy(async () => ({
  default: (await import('../workflows/WorkspaceV2.js')).WorkflowAccountRouteV2,
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

export function AppRouter() {
  return (
    <BrowserRouter>
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
            path="create"
            element={
              <PageBoundary>
                <WorkflowAccountRouteV2 startWorkflow />
              </PageBoundary>
            }
          />
          <Route
            path="account"
            element={
              <PageBoundary>
                <WorkflowAccountRouteV2 />
              </PageBoundary>
            }
          />
          <Route element={<WorkspaceLayout />}>
            <Route path="account/funds" element={<WorkflowAccountV2 manage />} />
            <Route path="workflows" element={<WorkflowsV2 />} />
            <Route path="workflows/new" element={<WorkflowBuilderV2 />} />
            <Route path="workflows/:id" element={<WorkflowDetailV2 />} />
            <Route path="workflows/:id/edit" element={<WorkflowBuilderV2 />} />
            <Route path="activity" element={<WorkflowActivityV2 />} />
            <Route path="runs/:id" element={<WorkflowProof />} />
            <Route path="rules" element={<Navigate to="/workflows" replace />} />
            <Route path="rules/:agent/:ruleId" element={<Navigate to="/workflows" replace />} />
            <Route path="proof" element={<WorkflowProofLookup />} />
            <Route path="proof/:reactiveTxHash" element={<Navigate to="/proof" replace />} />
            <Route path="marketplace" element={<WorkflowMarketplaceV2 />} />
            <Route path="marketplace/:listingId" element={<WorkflowListingV2 />} />
            <Route path="leaderboard" element={<Navigate to="/marketplace" replace />} />
            <Route path="cost" element={<WorkflowCost />} />
            <Route path="*" element={<Navigate to="/workflows" replace />} />
          </Route>
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
