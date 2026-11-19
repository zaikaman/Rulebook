import {
  agentAbi,
  draftFromRule,
  encodeAddRuleParams,
  getTemplate,
  type Address,
  type RuleParams,
} from '@rulebook/shared';
import { encodeFunctionData, formatUnits, zeroAddress } from 'viem';

import { knownToken } from '../lib/signatures.js';
import { dateTimeInputValue, isExpirySlot, scheduleInputText } from './numericFields.js';
import type { ComposerState } from './types.js';

export interface RuleReplacement {
  readonly ruleId: bigint;
  readonly flags: number;
}

export function encodeRuleSubmission(
  agent: Address,
  params: RuleParams,
  makePublic: boolean,
  edit?: RuleReplacement,
) {
  if (!edit) return encodeAddRuleParams(agent, params, { makePublic });
  return encodeFunctionData({
    abi: agentAbi,
    functionName: 'replaceRule',
    args: [edit.ruleId, edit.flags, { ...params, flags: 0, lastRun: 0n, runs: 0 }, makePublic],
  });
}

export function composerForRule(rule: RuleParams): ComposerState {
  const draft = draftFromRule({
    template: rule.template,
    chain_id: rule.chainId,
    pair: rule.pair,
    token_in: rule.tokenIn,
    token_out: rule.tokenOut,
    amount_in: rule.amountIn,
    threshold: rule.threshold,
    secondary: rule.secondary,
  });
  const token = knownToken(draft.chainId, rule.tokenIn);
  const template = getTemplate(draft.template);
  if (!template) throw new Error('This rule type is unavailable.');
  const slots: ComposerState['slots'] = {};
  for (const slot of template.slots) {
    const stored = draft.slots[slot.key];
    if (stored === undefined || stored === zeroAddress) continue;
    let input = stored;
    if (slot.kind === 'amount' && token) input = formatUnits(BigInt(stored), token.decimals);
    else if (slot.kind === 'price') input = formatUnits(BigInt(stored), 18);
    else if (slot.kind === 'percent') input = formatUnits(BigInt(stored), 2);
    else if (slot.kind === 'schedule') input = scheduleInputText(BigInt(stored) || 86_400n);
    else if (isExpirySlot(slot)) input = dateTimeInputValue(Number(stored) * 1_000, true);
    slots[slot.key] = input;
  }
  return { template: template.id, chainId: draft.chainId, slots };
}
