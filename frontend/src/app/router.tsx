import { BrowserRouter, Navigate, Route, Routes } from 'react-router';

import { AppShell } from '../components/AppShell.js';
import { Account } from '../pages/Account.js';
import { OfflineState } from '../components/OfflineState.js';
import { Cost } from '../pages/Cost.js';
import { Create } from '../pages/Create.js';
import { Home } from '../pages/Home.js';
import { LandingPage } from '../pages/LandingPage.js';
import { Marketplace } from '../pages/Marketplace.js';
import { Proof } from '../pages/Proof.js';
import { RuleDetail } from '../pages/RuleDetail.js';
import { ErrorBoundary } from './ErrorBoundary.js';
import { WorkflowActivity } from '../workflows/Activity.js';
import { WorkflowBuilder } from '../workflows/Builder.js';
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
import { WorkflowListingDetail } from '../workflows/Marketplace.js';
import { WorkflowListingV2, WorkflowMarketplaceV2 } from '../workflows/MarketplaceV2.js';
import { WorkflowDetail, WorkflowRunDetail, Workflows } from '../workflows/Workspace.js';
import { legacyWorkspace } from '../lib/routes.js';
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

          <Route
            path="create"
            element={legacyWorkspace ? <Create /> : <WorkflowAccountRouteV2 startWorkflow />}
          />
          <Route
            path="account"
            element={legacyWorkspace ? <Account /> : <WorkflowAccountRouteV2 />}
          />
          <Route element={<AppShell />}>
            {!legacyWorkspace && (
              <Route path="account/funds" element={<WorkflowAccountV2 manage />} />
            )}
            <Route path="workflows" element={legacyWorkspace ? <Workflows /> : <WorkflowsV2 />} />
            <Route
              path="workflows/new"
              element={legacyWorkspace ? <WorkflowBuilder /> : <WorkflowBuilderV2 />}
            />
            <Route
              path="workflows/:id"
              element={legacyWorkspace ? <WorkflowDetail /> : <WorkflowDetailV2 />}
            />
            <Route
              path="workflows/:id/edit"
              element={legacyWorkspace ? <WorkflowBuilder /> : <WorkflowBuilderV2 />}
            />
            <Route
              path="activity"
              element={legacyWorkspace ? <WorkflowActivity /> : <WorkflowActivityV2 />}
            />
            <Route
              path="runs/:id"
              element={legacyWorkspace ? <WorkflowRunDetail /> : <WorkflowProof />}
            />
            <Route
              path="rules"
              element={legacyWorkspace ? <Home /> : <Navigate to="/workflows" replace />}
            />
            <Route
              path="rules/:agent/:ruleId"
              element={legacyWorkspace ? <RuleDetail /> : <Navigate to="/workflows" replace />}
            />
            <Route path="proof" element={legacyWorkspace ? <Proof /> : <WorkflowProofLookup />} />
            <Route
              path="proof/:reactiveTxHash"
              element={legacyWorkspace ? <Proof /> : <Navigate to="/proof" replace />}
            />
            <Route
              path="marketplace"
              element={legacyWorkspace ? <Marketplace /> : <WorkflowMarketplaceV2 />}
            />
            <Route
              path="marketplace/:listingId"
              element={legacyWorkspace ? <WorkflowListingDetail /> : <WorkflowListingV2 />}
            />
            <Route path="leaderboard" element={<Navigate to="/marketplace" replace />} />
            <Route path="cost" element={legacyWorkspace ? <Cost /> : <WorkflowCost />} />
            {/* Fallback inside app */}
            <Route
              path="*"
              element={legacyWorkspace ? <Home /> : <Navigate to="/workflows" replace />}
            />
          </Route>
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
