import { getTemplate, type SlotKey, type TemplateSlot } from '@rulebook/shared';
import { useId, useState } from 'react';

import { ScheduleLabel } from '../components/ScheduleLabel.js';
import { knownToken } from '../lib/signatures.js';
import { amountCeiling, tokenAmount } from './amounts.js';
import { fieldOptions } from './fieldOptions.js';
import { ReceiveEstimate } from './ReceiveEstimate.js';
import type { ComposerState, SlotIssues, VaultTerms } from './types.js';

function fieldLabel(slot: TemplateSlot, swap: boolean): string {
  if (swap) {
    if (slot.key === 'token_in') return 'Pay with';
    if (slot.key === 'token_out') return 'Receive';
    if (slot.key === 'amount_in') return 'Amount to spend';
  }
  return slot.label.charAt(0).toUpperCase() + slot.label.slice(1);
}

export function RuleFields({
  state,
  issues,
  shownIssues,
  vault,
  setSlot,
  onTouch,
}: {
  readonly state: ComposerState;
  readonly issues: SlotIssues;
  readonly shownIssues: SlotIssues;
  readonly vault?: VaultTerms | undefined;
  readonly setSlot: (key: SlotKey, value: string) => void;
  readonly onTouch: (key: SlotKey) => void;
}) {
  const id = useId();
  const [openedAt] = useState(() => Math.floor(Date.now() / 1_000));
  const template = getTemplate(state.template);
  if (!template) return null;
  const { chainId, slots } = state;
  const swap = template.action === 'swap';
  const spendToken = knownToken(chainId, slots.token_in);
  const amount = template.slots.find((slot) => slot.key === 'amount_in');
  const ceiling = amount ? amountCeiling(amount, vault?.ceiling) : undefined;
  const tokens = template.slots.filter((slot) => slot.kind === 'token');
  const otherFields = template.slots.filter((slot) => slot.kind !== 'token' && slot !== amount);

  function field(slot: TemplateSlot) {
    const name = `${id}-${slot.key}`;
    const vaultToken =
      vault && template?.action !== 'alert' && slot.kind === 'token'
        ? slot.key === 'token_in'
          ? vault.tokenIn
          : vault.tokenOut
        : undefined;
    const issue =
      shownIssues[slot.key] ?? (vaultToken && slots[slot.key] ? issues[slot.key] : undefined);
    const isAmount = slot.kind === 'amount';
    const isWallet = slot.key === 'destination' || slot.key === 'source_wallet';
    const limit = isAmount ? amountCeiling(slot, vault?.ceiling) : undefined;
    const help =
      isAmount && limit !== undefined && spendToken
        ? `Up to ${tokenAmount(limit, spendToken)} per run.`
        : undefined;
    const fieldProps = {
      id: name,
      value: slots[slot.key] ?? '',
      'aria-invalid': issue ? true : undefined,
      'aria-describedby':
        [isAmount && spendToken && `${name}-unit`, issue ? `${name}-error` : help && `${name}-help`]
          .filter(Boolean)
          .join(' ') || undefined,
      'aria-required': slot.required || undefined,
    };

    return (
      <div
        className={`rule-composer__field${slot.key === 'amount_in' ? ' rule-composer__field--spend' : ''}${isWallet ? ' rule-composer__field--wide' : ''}`}
        data-slot={slot.key}
        data-invalid={issue ? 'true' : undefined}
        key={slot.key}
      >
        <label htmlFor={name}>{fieldLabel(slot, swap)}</label>
        {isAmount || isWallet ? (
          <div className="rule-composer__input-wrap">
            <input
              {...fieldProps}
              className="rule-composer__input"
              inputMode={isAmount ? 'decimal' : 'text'}
              placeholder={isAmount ? '0.00' : '0x…'}
              autoComplete="off"
              spellCheck={false}
              maxLength={isAmount ? 100 : undefined}
              onChange={(event) => setSlot(slot.key, event.target.value)}
              onBlur={() => {
                if (fieldProps.value) onTouch(slot.key);
              }}
            />
            {isAmount && spendToken && <span id={`${name}-unit`}>{spendToken.symbol}</span>}
          </div>
        ) : (
          <span className="rule-composer__select">
            <select {...fieldProps} onChange={(event) => setSlot(slot.key, event.target.value)}>
              <option value="">
                {slot.required ? 'Choose…' : slot.key === 'pair' ? 'Default pool' : 'None'}
              </option>
              {fieldOptions(slot, chainId, openedAt)
                .filter(
                  (option) =>
                    !vaultToken || option.value.toLowerCase() === vaultToken.toLowerCase(),
                )
                .map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
            </select>
          </span>
        )}
        {issue ? (
          <p id={`${name}-error`} className="rule-composer__slot-error">
            {issue}
          </p>
        ) : (
          help && (
            <p id={`${name}-help`} className="rule-composer__hint">
              {help}
            </p>
          )
        )}
      </div>
    );
  }

  return (
    <div className="rule-composer__settings">
      {tokens.length > 0 && <div className="rule-composer__fields">{tokens.map(field)}</div>}
      {amount && field(amount)}
      {swap && (
        <ReceiveEstimate
          key={`${slots.token_in}:${slots.token_out}`}
          chainId={chainId}
          tokenIn={slots.token_in}
          tokenOut={slots.token_out}
          ceiling={ceiling}
          canQuote={!issues.token_in && !issues.token_out}
          onApply={(value) => setSlot('amount_in', value)}
        />
      )}
      {otherFields.length > 0 && (
        <div className="rule-composer__fields">{otherFields.map(field)}</div>
      )}
      {slots.schedule && <ScheduleLabel seconds={slots.schedule} />}
    </div>
  );
}
