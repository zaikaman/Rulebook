import { getTemplate, type SlotKey, type TemplateSlot } from '@rulebook/shared';
import { useId } from 'react';

import { ScheduleLabel } from '../components/ScheduleLabel.js';
import { knownToken } from '../lib/signatures.js';
import { amountCeiling, tokenAmount } from './amounts.js';
import { fieldOptions } from './fieldOptions.js';
import {
  SCHEDULE_UNIT_OPTIONS,
  dateTimeInputValue,
  isExpirySlot,
  isTypedNumericSlot,
  parseScheduleText,
  scheduleText,
  slotInputSuffix,
  textToCanonical,
  type ScheduleUnit,
} from './numericFields.js';
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

/**
 * A numeric slot the user types: a price, a percentage, a repeat interval, an expiry, or a
 * number of days. Values stay as typed text in the composer and convert to contract units only
 * when the draft is validated.
 */
function NumericControl({
  slot,
  id,
  label,
  suffix,
  value,
  invalid,
  describedBy,
  required,
  setValue,
  onBlur,
}: {
  readonly slot: TemplateSlot;
  readonly id: string;
  readonly label: string;
  readonly suffix: string | undefined;
  readonly value: string;
  readonly invalid: boolean;
  readonly describedBy: string | undefined;
  readonly required: boolean;
  readonly setValue: (value: string) => void;
  readonly onBlur: () => void;
}) {
  const shared = {
    id,
    'aria-invalid': invalid || undefined,
    'aria-describedby': describedBy,
    'aria-required': required || undefined,
    autoComplete: 'off',
    spellCheck: false,
    onBlur: () => {
      if (value) onBlur();
    },
  } as const;

  if (isExpirySlot(slot)) {
    return (
      <input
        {...shared}
        className="rule-composer__input rule-composer__input--datetime"
        type="datetime-local"
        value={value}
        min={dateTimeInputValue(Date.now())}
        step={60}
        onChange={(event) => setValue(event.target.value)}
      />
    );
  }

  if (slot.kind === 'schedule') {
    const { count, unit } = parseScheduleText(value);
    return (
      <div className="rule-composer__compound">
        <input
          {...shared}
          className="rule-composer__input"
          inputMode="decimal"
          placeholder="1"
          maxLength={8}
          value={count}
          onChange={(event) => setValue(scheduleText(event.target.value, unit))}
        />
        <span className="rule-composer__select rule-composer__select--unit">
          <select
            aria-label={`${label} unit`}
            value={unit}
            onChange={(event) => setValue(scheduleText(count, event.target.value as ScheduleUnit))}
          >
            {SCHEDULE_UNIT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </span>
      </div>
    );
  }

  return (
    <div className="rule-composer__input-wrap">
      <input
        {...shared}
        className="rule-composer__input"
        inputMode="decimal"
        placeholder={slot.kind === 'price' ? '2500' : slot.kind === 'percent' ? '2.5' : '30'}
        maxLength={32}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      {suffix && <span id={`${id}-unit`}>{suffix}</span>}
    </div>
  );
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
  const template = getTemplate(state.template);
  if (!template) return null;
  const { chainId, slots } = state;
  const swap = template.action === 'swap';
  const spendToken = knownToken(chainId, slots.token_in);
  const amount = template.slots.find((slot) => slot.key === 'amount_in');
  const ceiling = amount ? amountCeiling(amount, vault?.ceiling) : undefined;
  const tokens = template.slots.filter((slot) => slot.kind === 'token');
  const otherFields = template.slots.filter((slot) => slot.kind !== 'token' && slot !== amount);
  const scheduleSlot = template.slots.find((slot) => slot.kind === 'schedule');
  const schedule =
    scheduleSlot && slots.schedule ? textToCanonical(scheduleSlot, slots.schedule) : undefined;

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
    const label = fieldLabel(slot, swap);
    const isAmount = slot.kind === 'amount';
    const isWallet = slot.key === 'destination' || slot.key === 'source_wallet';
    const isNumeric = isTypedNumericSlot(slot);
    const suffix = isNumeric ? slotInputSuffix(slot, chainId) : undefined;
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
        [
          (isAmount && spendToken) || suffix ? `${name}-unit` : undefined,
          issue ? `${name}-error` : help && `${name}-help`,
        ]
          .filter(Boolean)
          .join(' ') || undefined,
      'aria-required': slot.required || undefined,
    };

    return (
      <div
        className={`rule-composer__field${slot.key === 'amount_in' ? ' rule-composer__field--spend' : ''}${isWallet ? ' rule-composer__field--wide' : ''}${isNumeric ? ' rule-composer__field--numeric' : ''}`}
        data-slot={slot.key}
        data-invalid={issue ? 'true' : undefined}
        key={slot.key}
      >
        <label htmlFor={name}>{label}</label>
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
        ) : isNumeric ? (
          <NumericControl
            slot={slot}
            id={name}
            label={label}
            suffix={suffix}
            value={fieldProps.value}
            invalid={!!issue}
            describedBy={fieldProps['aria-describedby']}
            required={slot.required}
            setValue={(value) => setSlot(slot.key, value)}
            onBlur={() => onTouch(slot.key)}
          />
        ) : (
          <span className="rule-composer__select">
            <select {...fieldProps} onChange={(event) => setSlot(slot.key, event.target.value)}>
              <option value="">
                {slot.required ? 'Choose…' : slot.key === 'pair' ? 'Default pool' : 'None'}
              </option>
              {fieldOptions(slot, chainId)
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
      {schedule && 'value' in schedule && <ScheduleLabel seconds={schedule.value} />}
    </div>
  );
}
