import { BrowserRouter, Navigate, Route, Routes } from 'react-router';

import { AppShell } from '../components/AppShell.js';
import { OfflineState } from '../components/OfflineState.js';
import { LandingPage } from '../pages/LandingPage.js';
import { ErrorBoundary } from './ErrorBoundary.js';
import { WorkflowBuilderV2 } from '../workflows/BuilderV2.js';
import { WorkflowProof, WorkflowProofLookup } from '../workflows/WorkflowProof.js';
import { WorkflowCost } from '../workflows/WorkflowCost.js';
import {
  WorkflowAccountRouteV2,
  WorkflowAccountV2,
  WorkflowActivityV2,
  WorkflowDetailV2,
  WorkflowsV2,
} from '../workflows/WorkspaceV2.js';
import { WorkflowListingV2, WorkflowMarketplaceV2 } from '../workflows/MarketplaceV2.js';
import '../styles/workflows.css';
import '../styles/app.css';

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

          <Route path="create" element={<WorkflowAccountRouteV2 startWorkflow />} />
          <Route path="account" element={<WorkflowAccountRouteV2 />} />
          <Route element={<AppShell />}>
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
