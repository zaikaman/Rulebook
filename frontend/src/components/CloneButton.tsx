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
        aria-label={`Clone ${title}`}
        onClick={() => setOpen(true)}
        className="w-full rounded-full bg-white px-4 py-2 text-xs font-semibold text-black transition-colors hover:bg-neutral-200"
      >
        Clone into my vault
      </button>
    );
  }

  return (
    <section
      aria-label="Clone preview"
      className="space-y-2 rounded-xl border border-white/10 bg-[#04060a] p-3"
    >
      <p className="text-[11px] leading-relaxed text-neutral-400">
        This copies the author&apos;s exact parameters into your own automation account. You sign
        once on Lasna with your own per-run ceiling and budget.
      </p>

      {clone.loading ? <p className="text-xs text-neutral-400">Loading the published rule…</p> : null}

      {clone.sentence ? (
        <p className="text-xs leading-relaxed text-neutral-100">“{clone.sentence}”</p>
      ) : null}

      {clone.guard && !clone.guard.ok ? (
        <p role="alert" className="text-xs leading-relaxed text-amber-300">
          {clone.guard.message}{' '}
          {clone.guard.code === 'no_agent' ? (
            <Link to={appRoutes.account} className="underline">
              Create your account
            </Link>
          ) : null}
        </p>
      ) : null}

      {clone.error ? (
        <p role="alert" className="text-xs leading-relaxed text-silent">
          {clone.error.message}
          {clone.error.selector ? (
            <span className="block font-mono text-[10px] text-neutral-500">
              selector {clone.error.selector}
            </span>
          ) : null}
        </p>
      ) : null}

      {clone.result ? (
        <div className="space-y-1 rounded-lg border border-active/40 bg-active/5 p-2">
          <p className="text-xs text-neutral-100">
            Cloned{clone.result.ruleId !== null ? ` as rule #${clone.result.ruleId.toString()}` : ''}
            . It now runs on your account.
          </p>
          <Link to={appRoutes.rules} className="text-xs text-automation underline">
            View your rules
          </Link>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!clone.canClone}
          onClick={() => void clone.clone()}
          className="rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-surface disabled:opacity-50"
        >
          {clone.status === 'simulating'
            ? 'Checking your account…'
            : clone.status === 'signing'
              ? 'Waiting for your signature…'
              : clone.status === 'confirming'
                ? 'Waiting for the Lasna receipt…'
                : 'Confirm clone'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-full border border-border px-3 py-1.5 text-xs text-ink"
        >
          Close
        </button>
      </div>
    </section>
  );
}
