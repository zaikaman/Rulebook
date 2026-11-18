import type { Listing } from '@rulebook/shared';
import { useState } from 'react';
import { Link } from 'react-router';

import { useCloneRule } from '../hooks/useCloneRule.js';
import { appRoutes } from '../lib/routes.js';
import { listingTitle } from '../lib/listings.js';

export interface CloneButtonProps {
  readonly listing: Listing;
}

/**
 * A two-step clone: the panel first shows the author's exact sentence rebuilt from the
 * published parameters, every refusal reason, and only then the one signature that creates a
 * private copy on the cloner's own Agent.
 */
export function CloneButton({ listing }: CloneButtonProps) {
  const [open, setOpen] = useState(false);
  const clone = useCloneRule(listing, open);
  const title = listingTitle(listing);

  if (!open) {
    return (
      <button
        type="button"
        aria-label={`Clone into my vault: ${title}`}
        onClick={() => setOpen(true)}
        className="app-button"
      >
        Clone into my vault
      </button>
    );
  }

  return (
    <section aria-label="Clone preview" className="w-full space-y-3">
      <p className="app-copy">
        This copies the author&apos;s exact parameters into your own automation account. You sign
        once on Lasna with your own per-run ceiling and budget.
      </p>

      {clone.loading ? (
        <p role="status" className="app-copy">
          Loading the published rule…
        </p>
      ) : null}

      {clone.sentence ? (
        <p className="break-words text-sm leading-relaxed text-ink">“{clone.sentence}”</p>
      ) : null}

      {clone.guard && !clone.guard.ok ? (
        <p role="alert" className="app-alert text-xs leading-relaxed" data-tone="warning">
          {clone.guard.message}{' '}
          {clone.guard.code === 'no_agent' ? (
            <Link to={appRoutes.account} className="app-link">
              Create your account
            </Link>
          ) : null}
        </p>
      ) : null}

      {clone.error ? (
        <p role="alert" className="app-alert text-xs leading-relaxed" data-tone="error">
          {clone.error.message}
          {clone.error.selector ? (
            <span className="block font-mono text-xs text-ink-muted">
              selector {clone.error.selector}
            </span>
          ) : null}
        </p>
      ) : null}

      {clone.result ? (
        <div className="app-alert space-y-1" data-tone="success">
          <p className="text-sm text-ink">
            Cloned
            {clone.result.ruleId !== null ? ` as rule #${clone.result.ruleId.toString()}` : ''}. It
            now runs on your account.
          </p>
          <Link to={appRoutes.rules} className="app-link text-xs">
            View your rules
          </Link>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!clone.canClone}
          onClick={() => void clone.clone()}
          className="app-button app-button--primary"
        >
          {clone.status === 'simulating'
            ? 'Checking your account…'
            : clone.status === 'signing'
              ? 'Waiting for your signature…'
              : clone.status === 'confirming'
                ? 'Waiting for the Lasna receipt…'
                : 'Confirm clone'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="app-button">
          Close
        </button>
      </div>
    </section>
  );
}
