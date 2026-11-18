import { encodeAddRule, LASNA_CHAIN_ID, type Address, type DraftError } from '@rulebook/shared';
import { useEffect, useMemo, useState } from 'react';

import { NetworkBadge } from '../components/NetworkBadge.js';

import type { ReadyDraft } from './types.js';

const DEBOUNCE_MS = 50;

function encodeSafely(
  agent: Address,
  draft: ReadyDraft,
  makePublic: boolean,
): { data?: `0x${string}`; error?: string } {
  try {
    return { data: encodeAddRule(agent, draft, { makePublic }) };
  } catch (error) {
    const draftError = error as DraftError;
    return { error: draftError.message };
  }
}

/**
 * The exact `addRule` transaction for the sentence above, recomputed at most every 50 ms.
 * Incomplete drafts show the missing slots instead of a partial encoding.
 */
export function LiveCalldata({
  agent,
  draft,
  makePublic = false,
}: {
  readonly agent: Address;
  readonly draft: ReadyDraft | null;
  readonly makePublic?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [settled, setSettled] = useState<{ data?: `0x${string}`; error?: string }>();

  const result = useMemo(() => {
    if (!draft) return undefined;
    return encodeSafely(agent, draft, makePublic);
  }, [agent, draft, makePublic]);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(result), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [result]);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1_500);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy(): Promise<void> {
    if (!settled?.data) return;
    await navigator.clipboard.writeText(settled.data);
    setCopied(true);
  }

  if (!draft) {
    return (
      <section
        aria-label="Transaction preview"
        className="space-y-2 rounded-lg border border-border p-4"
      >
        <h2 className="text-sm font-medium text-ink">Transaction preview</h2>
        <p className="text-xs text-ink-muted">
          Fill every blank to see the exact transaction this sentence creates.
        </p>
      </section>
    );
  }

  return (
    <section
      aria-label="Transaction preview"
      className="space-y-2 rounded-lg border border-border p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium text-ink">Transaction preview</h2>
        <NetworkBadge chainId={LASNA_CHAIN_ID} />
      </div>
      <p className="text-xs text-ink-muted">
        Sent to your Agent on <span className="font-mono">{agent}</span>. No funds move in this
        transaction.
      </p>
      {settled?.error ? (
        <p role="alert" className="text-xs text-silent">
          {settled.error}
        </p>
      ) : (
        <>
          <code
            data-testid="live-calldata"
            className="block max-h-32 overflow-auto rounded bg-surface-raised p-2 font-mono text-[11px] text-ink-muted"
          >
            {settled?.data ?? '…'}
          </code>
          <button
            type="button"
            onClick={() => void copy()}
            className="rounded border border-border px-2 py-1 text-xs text-ink"
          >
            {copied ? 'Copied' : 'Copy calldata'}
          </button>
        </>
      )}
    </section>
  );
}
