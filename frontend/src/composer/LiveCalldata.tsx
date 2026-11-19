import { Copy01Icon, FileValidationIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  encodeAddRule,
  getTemplate,
  LASNA_CHAIN_ID,
  type Address,
  type DraftError,
} from '@rulebook/shared';
import { useEffect, useMemo, useState } from 'react';

import { NetworkBadge } from '../components/NetworkBadge.js';

import type { ReadyDraft } from './types.js';

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
 * The exact `addRule` transaction for the sentence above, once the draft is valid.
 */
export function LiveCalldata({
  agent,
  draft,
  sentence,
  makePublic = false,
  complete,
  required,
}: {
  readonly agent: Address;
  readonly draft: ReadyDraft | null;
  readonly sentence: string;
  readonly makePublic?: boolean;
  readonly complete: number;
  readonly required: number;
}) {
  const [copyResult, setCopyResult] = useState<{ data: string; ok: boolean }>();

  const result = useMemo(() => {
    if (!draft) return undefined;
    return encodeSafely(agent, draft, makePublic);
  }, [agent, draft, makePublic]);

  useEffect(() => {
    if (!copyResult?.ok) return undefined;
    const timer = setTimeout(() => setCopyResult(undefined), 1_500);
    return () => clearTimeout(timer);
  }, [copyResult]);

  async function copy(data: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(data);
      setCopyResult({ data, ok: true });
    } catch {
      setCopyResult({ data, ok: false });
    }
  }

  const data = result?.data;
  const copyState = copyResult?.data === data ? copyResult : undefined;

  return (
    <section aria-labelledby="transaction-preview-heading" className="rule-composer__preview">
      <div className="rule-composer__preview-heading">
        <span className="rule-composer__preview-icon">
          <HugeiconsIcon icon={FileValidationIcon} size={19} aria-hidden="true" />
        </span>
        <h2 id="transaction-preview-heading">Transaction preview</h2>
      </div>
      {required > 0 && (
        <div className="rule-composer__progress">
          <div className="rule-composer__progress-label">
            <span>Required values</span>
            <span>
              {complete} / {required}
            </span>
          </div>
          <div
            className="rule-composer__segments"
            role="progressbar"
            aria-label="Required values completed"
            aria-valuenow={complete}
            aria-valuemin={0}
            aria-valuemax={required}
          >
            {Array.from({ length: required }, (_, index) => (
              <div key={index} data-complete={index < complete} />
            ))}
          </div>
        </div>
      )}
      <div className="rule-composer__preview-body">
        {result?.error ? (
          <p role="alert" className="rule-composer__slot-error">
            {result.error}
          </p>
        ) : data ? (
          <>
            <p className="rule-composer__sentence" data-testid="composer-sentence">
              {sentence}
            </p>
            {draft && getTemplate(draft.template)?.action === 'swap' && (
              <p>
                The spend is fixed per run. The amount received depends on the pool at execution.
              </p>
            )}
            <details className="rule-composer__details">
              <summary>Calldata</summary>
              <code data-testid="live-calldata" className="rule-composer__calldata">
                {data}
              </code>
              <button type="button" onClick={() => void copy(data)}>
                <HugeiconsIcon icon={Copy01Icon} size={14} aria-hidden="true" />
                {copyState?.ok ? 'Copied' : 'Copy calldata'}
              </button>
              {copyState?.ok === false && (
                <p role="status">Copy failed. Select the calldata to copy it manually.</p>
              )}
            </details>
          </>
        ) : (
          <p>
            {complete === required
              ? 'The preview will appear once the rule passes its checks.'
              : 'Complete the rule settings to preview what you’ll sign.'}
          </p>
        )}
      </div>
      <dl className="rule-composer__network">
        <div>
          <dt>Signing network</dt>
          <dd>
            <NetworkBadge chainId={LASNA_CHAIN_ID} />
          </dd>
        </div>
        {draft && getTemplate(draft.template)?.action !== 'alert' && (
          <div>
            <dt>Funds network</dt>
            <dd>
              <NetworkBadge chainId={draft.chainId} />
            </dd>
          </div>
        )}
        {data && (
          <div>
            <dt>Agent</dt>
            <dd>
              <code title={agent}>
                {agent.slice(0, 8)}…{agent.slice(-6)}
              </code>
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}
