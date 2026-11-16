import { BrowserRouter, Route, Routes } from 'react-router';

import { AppShell } from '../components/AppShell.js';
import { Account } from '../pages/Account.js';
import { ErrorBoundary } from './ErrorBoundary.js';

function Placeholder({ title, note }: { readonly title: string; readonly note: string }) {
  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-ink-muted">{note}</p>
    </section>
  );
}

/** The eight routes from plan.md. Page implementations land in their user-story phases. */
export function AppRouter() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <Routes>
          <Route element={<AppShell />}>
            <Route
              index
              element={
                <Placeholder
                  title="Your rules"
                  note="Rule list ordered by on-chain evaluation order."
                />
              }
            />
            <Route
              path="create"
              element={
                <Placeholder title="Create a rule" note="Assemble a sentence and sign once." />
              }
            />
            <Route
              path="rules/:agent/:ruleId"
              element={
                <Placeholder
                  title="Rule detail"
                  note="The rule as a sentence, its executions, and its budget."
                />
              }
            />
            <Route
              path="proof/:reactiveTxHash"
              element={
                <Placeholder
                  title="Proof"
                  note="Origin event, automation transaction, funds-side transaction."
                />
              }
            />
            <Route
              path="marketplace"
              element={
                <Placeholder
                  title="Marketplace"
                  note="Public rules you can clone into your own account."
                />
              }
            />
            <Route
              path="leaderboard"
              element={
                <Placeholder title="Leaderboard" note="Rules ranked by runs and success rate." />
              }
            />
            <Route path="account" element={<Account />} />
            <Route
              path="cost"
              element={
                <Placeholder
                  title="Cost model"
                  note="Who pays for what, and why custody stays with you."
                />
              }
            />
          </Route>
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
