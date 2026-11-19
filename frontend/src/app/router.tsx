import { BrowserRouter, Route, Routes } from 'react-router';

import { AppShell } from '../components/AppShell.js';
import { Account } from '../pages/Account.js';
import { OfflineState } from '../components/OfflineState.js';
import { Cost } from '../pages/Cost.js';
import { Create } from '../pages/Create.js';
import { Home } from '../pages/Home.js';
import { LandingPage } from '../pages/LandingPage.js';
import { Leaderboard } from '../pages/Leaderboard.js';
import { Marketplace } from '../pages/Marketplace.js';
import { Proof } from '../pages/Proof.js';
import { RuleDetail } from '../pages/RuleDetail.js';
import { ErrorBoundary } from './ErrorBoundary.js';

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

          <Route path="create" element={<Create />} />
          <Route path="account" element={<Account />} />
          <Route element={<AppShell />}>
            <Route path="rules" element={<Home />} />
            <Route path="rules/:agent/:ruleId" element={<RuleDetail />} />
            <Route path="proof" element={<Proof />} />
            <Route path="proof/:reactiveTxHash" element={<Proof />} />
            <Route path="marketplace" element={<Marketplace />} />
            <Route path="leaderboard" element={<Leaderboard />} />
            <Route path="cost" element={<Cost />} />
            {/* Fallback inside app */}
            <Route path="*" element={<Home />} />
          </Route>
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
