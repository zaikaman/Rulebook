import {
  CHAIN_CONFIGS,
  draftFromRule,
  getTemplate,
  readableSentence,
  type Rule,
  type RuleDraft,
} from '@rulebook/shared';
import { formatUnits } from 'viem';

import { knownToken } from './signatures.js';

export const RULE_FLAGS = { active: 1, latched: 2, mirrored: 4, cancelled: 8 } as const;

export function ruleLifecycle(rule: Rule, flags?: number) {
  if (rule.replaced_by !== undefined) return 'cancelled';
  if (flags === undefined)
    return rule.status === 'active' && rule.latched ? 'latched' : rule.status;
  if ((flags & RULE_FLAGS.cancelled) !== 0) return 'cancelled';
  if ((flags & RULE_FLAGS.active) === 0) return 'paused';
  return (flags & RULE_FLAGS.latched) !== 0 ? 'latched' : 'active';
}

const SCHEDULE_UNITS = [
  [604_800n, 'week'],
  [86_400n, 'day'],
  [3_600n, 'hour'],
  [60n, 'minute'],
] as const;

function scheduleLabel(value: bigint): string {
  const unit = SCHEDULE_UNITS.find(([seconds]) => value > 0n && value % seconds === 0n);
  if (!unit) return `${value} seconds`;
  const [seconds, label] = unit;
  const count = value / seconds;
  return count === 1n ? label : `${count} ${label}s`;
}

/** Formats the exact stored values for display. Unknown tokens keep their raw units and address. */
export function formatRuleSentence(draft: RuleDraft): string {
  const template = getTemplate(draft.template);
  if (!template) return readableSentence(draft);
  const chain = CHAIN_CONFIGS.get(draft.chainId);
  const spendToken = knownToken(draft.chainId, draft.slots.token_in);
  const slots = { ...draft.slots };

  for (const slot of template.slots) {
    const value =
      slots[slot.key] ??
      (slot.key === 'pair'
        ? chain?.pair
        : slot.kind === 'percent' && !slot.required
          ? '0'
          : undefined);
    if (!value) continue;
    if (slot.kind === 'token') {
      slots[slot.key] = knownToken(draft.chainId, value)?.symbol ?? value;
    } else if (slot.key === 'pair' && value.toLowerCase() === chain?.pair.toLowerCase()) {
      slots[slot.key] = 'the USDC/WETH pool';
    } else if (slot.kind === 'schedule') {
      slots[slot.key] = scheduleLabel(BigInt(value));
    } else if (slot.kind === 'amount') {
      slots[slot.key] = spendToken
        ? formatUnits(BigInt(value), spendToken.decimals)
        : `${value} base units${template.sentence.includes(`{${slot.key}} {token_in}`) ? ' of' : ''}`;
    } else if (slot.kind === 'price' || slot.kind === 'percent') {
      slots[slot.key] =
        slot.kind === 'price'
          ? formatUnits(BigInt(value), 18)
          : `${formatUnits(BigInt(value), 2)}%`;
    } else if (slot.unit === 'unix seconds') {
      const expiry = new Date(Number(value) * 1_000);
      if (!Number.isNaN(expiry.valueOf())) {
        slots[slot.key] = expiry.toISOString().replace('T', ' ').replace('.000Z', ' UTC');
      }
    }
  }

  return readableSentence({ ...draft, slots });
}

/** A stored rule rendered as a sentence, with a labelled fallback for unreadable records. */
export function ruleSentence(rule: Rule): string {
  try {
    return formatRuleSentence(draftFromRule(rule));
  } catch {
    return `Rule #${rule.rule_id.toString()}`;
  }
}

/** ISO timestamp as a short, timezone-explicit label; `—` when the rule never ran. */
export function lastRunLabel(rule: Rule): string {
  if (!rule.last_run_at) return 'never';
  return new Date(rule.last_run_at).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}
