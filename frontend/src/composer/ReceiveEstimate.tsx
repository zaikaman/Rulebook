import { getChain, type Address } from '@rulebook/shared';
import { useId, useState } from 'react';
import { formatUnits, parseAbi } from 'viem';

import { knownToken } from '../lib/signatures.js';
import { unichainPublicClient } from '../lib/wagmi.js';
import { parseDecimalAmount, tokenAmount } from './amounts.js';

const quoteAbi = parseAbi([
  'function getAmountsIn(uint256 amountOut, address[] path) view returns (uint256[] amounts)',
]);

type QuoteResult =
  | { readonly kind: 'loading' }
  | { readonly kind: 'invalid' | 'error'; readonly message: string }
  | { readonly kind: 'quoted'; readonly spend: bigint; readonly receive: bigint };

export function ReceiveEstimate({
  chainId,
  tokenIn,
  tokenOut,
  ceiling,
  canQuote,
  onApply,
}: {
  readonly chainId: number;
  readonly tokenIn: string | undefined;
  readonly tokenOut: string | undefined;
  readonly ceiling: bigint | undefined;
  readonly canQuote: boolean;
  readonly onApply: (amount: string) => void;
}) {
  const id = useId();
  const [target, setTarget] = useState('');
  const [result, setResult] = useState<QuoteResult>();
  const spendToken = knownToken(chainId, tokenIn);
  const receiveToken = knownToken(chainId, tokenOut);
  const loading = result?.kind === 'loading';
  const overLimit = result?.kind === 'quoted' && ceiling !== undefined && result.spend > ceiling;

  async function estimate() {
    if (!canQuote || loading || !receiveToken || !tokenIn || !tokenOut) return;
    const parsed = parseDecimalAmount(target, receiveToken.decimals);
    if ('error' in parsed) {
      setResult({ kind: 'invalid', message: parsed.error });
      return;
    }

    setResult({ kind: 'loading' });
    try {
      const [spend] = await unichainPublicClient.readContract({
        address: getChain(chainId).router,
        abi: quoteAbi,
        functionName: 'getAmountsIn',
        args: [parsed.amount, [tokenIn as Address, tokenOut as Address]],
      });
      if (!spend || spend <= 0n) throw new Error('Empty quote');
      setResult({ kind: 'quoted', spend, receive: parsed.amount });
    } catch {
      setResult({
        kind: 'error',
        message: 'No quote is available for this amount. Try a smaller amount or try again.',
      });
    }
  }

  return (
    <details className="rule-composer__estimate">
      <summary>Quote a target receive amount</summary>
      <div className="rule-composer__estimate-body">
        <p id={`${id}-hint`}>
          Use a pool quote to set a fixed spend. The amount received can change before the rule
          runs.
        </p>
        {!canQuote && <p>Choose a valid pair of tokens to get a quote.</p>}
        <label htmlFor={id}>Target receive amount</label>
        <div className="rule-composer__estimate-controls">
          <div className="rule-composer__input-wrap">
            <input
              id={id}
              className="rule-composer__input"
              inputMode="decimal"
              placeholder="0.1"
              autoComplete="off"
              maxLength={100}
              aria-invalid={result?.kind === 'invalid' || undefined}
              aria-describedby={[
                receiveToken && `${id}-unit`,
                result?.kind === 'invalid' && `${id}-error`,
                `${id}-hint`,
              ]
                .filter(Boolean)
                .join(' ')}
              readOnly={loading}
              disabled={!canQuote}
              value={target}
              onChange={(event) => {
                setTarget(event.target.value);
                setResult(undefined);
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                void estimate();
              }}
            />
            {receiveToken && <span id={`${id}-unit`}>{receiveToken.symbol}</span>}
          </div>
          <button
            type="button"
            className="rule-composer__secondary"
            disabled={!canQuote || !target.trim() || loading}
            onClick={() => void estimate()}
          >
            {loading ? 'Getting quote…' : 'Get quote'}
          </button>
        </div>
        {(result?.kind === 'invalid' || result?.kind === 'error') && (
          <p id={`${id}-error`} role="alert">
            {result.message}
          </p>
        )}
        {result?.kind === 'quoted' && spendToken && receiveToken && (
          <div className="rule-composer__estimate-result">
            <p role="status">
              At the quoted price, {tokenAmount(result.receive, receiveToken)} costs{' '}
              <strong>{tokenAmount(result.spend, spendToken)}</strong>.
              {overLimit && ceiling !== undefined && (
                <span className="rule-composer__estimate-limit">
                  {' '}
                  This exceeds the {tokenAmount(ceiling, spendToken)} per-run limit.
                </span>
              )}
            </p>
            {!overLimit && canQuote && (
              <button
                type="button"
                className="rule-composer__secondary"
                onClick={() => onApply(formatUnits(result.spend, spendToken.decimals))}
              >
                Use {tokenAmount(result.spend, spendToken)} as spend
              </button>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
