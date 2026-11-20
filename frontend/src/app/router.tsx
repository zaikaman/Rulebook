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
import {
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

          {legacyWorkspace && <Route path="create" element={<Create />} />}
          {legacyWorkspace && <Route path="account" element={<Account />} />}
          <Route element={<AppShell />}>
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
              element={legacyWorkspace ? <WorkflowRunDetail /> : <WorkflowActivityV2 />}
            />
            <Route
              path="rules"
              element={legacyWorkspace ? <Home /> : <Navigate to="/workflows" replace />}
            />
            <Route path="rules/:agent/:ruleId" element={<RuleDetail />} />
            {!legacyWorkspace && (
              <Route path="create" element={<Navigate to="/workflows/new" replace />} />
            )}
            {!legacyWorkspace && <Route path="account" element={<WorkflowAccountV2 />} />}
            <Route path="proof" element={<Proof />} />
            <Route path="proof/:reactiveTxHash" element={<Proof />} />
            <Route
              path="marketplace"
              element={legacyWorkspace ? <Marketplace /> : <WorkflowMarketplaceV2 />}
            />
            <Route
              path="marketplace/:listingId"
              element={legacyWorkspace ? <WorkflowListingDetail /> : <WorkflowListingV2 />}
            />
            <Route path="leaderboard" element={<Navigate to="/marketplace" replace />} />
            <Route path="cost" element={<Cost />} />
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
