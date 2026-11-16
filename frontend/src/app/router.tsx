import { BrowserRouter, Route, Routes } from 'react-router';

import { AppShell } from '../components/AppShell.js';
import { Account } from '../pages/Account.js';
import { CostModelPage } from '../pages/CostModelPage.js';
import { CreateRulePage } from '../pages/CreateRulePage.js';
import { LandingPage } from '../pages/LandingPage.js';
import { LeaderboardPage } from '../pages/LeaderboardPage.js';
import { MarketplacePage } from '../pages/MarketplacePage.js';
import { ProofPage } from '../pages/ProofPage.js';
import { RuleDetailPage } from '../pages/RuleDetailPage.js';
import { RulesPage } from '../pages/RulesPage.js';
import { ErrorBoundary } from './ErrorBoundary.js';

export function AppRouter() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <Routes>
          {/* Public Landing Page cloned from Parallel's design system */}
          <Route path="/" element={<LandingPage />} />

          {/* App Workspace inside Parallel's sleek dark AppShell */}
          <Route element={<AppShell />}>
            <Route path="rules" element={<RulesPage />} />
            <Route path="create" element={<CreateRulePage />} />
            <Route path="rules/:agent/:ruleId" element={<RuleDetailPage />} />
            <Route path="proof" element={<ProofPage />} />
            <Route path="proof/:reactiveTxHash" element={<ProofPage />} />
            <Route path="marketplace" element={<MarketplacePage />} />
            <Route path="leaderboard" element={<LeaderboardPage />} />
            <Route path="account" element={<Account />} />
            <Route path="cost" element={<CostModelPage />} />
            {/* Fallback inside app */}
            <Route path="*" element={<RulesPage />} />
          </Route>
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
