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
import { WorkflowBuilder } from '../workflows/Builder.js';
import { WorkflowListingDetail, WorkflowMarketplace } from '../workflows/Marketplace.js';
import {
  WorkflowAccount,
  WorkflowDetail,
  WorkflowRunDetail,
  Workflows,
} from '../workflows/Workspace.js';
import { legacyWorkspace } from '../lib/routes.js';
import '../styles/workflows.css';

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
            <Route path="workflows" element={<Workflows />} />
            <Route path="workflows/new" element={<WorkflowBuilder />} />
            <Route path="workflows/:id" element={<WorkflowDetail />} />
            <Route path="workflows/:id/edit" element={<WorkflowBuilder />} />
            <Route path="runs/:id" element={<WorkflowRunDetail />} />
            <Route
              path="rules"
              element={legacyWorkspace ? <Home /> : <Navigate to="/workflows" replace />}
            />
            <Route path="rules/:agent/:ruleId" element={<RuleDetail />} />
            {!legacyWorkspace && (
              <Route path="create" element={<Navigate to="/workflows/new" replace />} />
            )}
            {!legacyWorkspace && <Route path="account" element={<WorkflowAccount />} />}
            <Route path="proof" element={<Proof />} />
            <Route path="proof/:reactiveTxHash" element={<Proof />} />
            <Route
              path="marketplace"
              element={legacyWorkspace ? <Marketplace /> : <WorkflowMarketplace />}
            />
            <Route path="marketplace/:listingId" element={<WorkflowListingDetail />} />
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
